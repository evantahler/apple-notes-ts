import type { Database } from "bun:sqlite";
import type {
  Chat,
  Handle,
  ListChatsOptions,
  ListMessagesOptions,
  MessageAttachment,
  MessageMeta,
  SearchMessagesOptions,
} from "../types.ts";
import * as Q from "./queries.ts";

interface HandleRow {
  id: number;
  identifier: string;
  service: string;
}

interface ChatRow {
  id: number;
  guid: string;
  displayName: string | null;
  chatIdentifier: string;
  style: number;
  serviceName: string;
  lastMessageDate: number | null;
}

interface ParticipantRow {
  identifier: string;
}

interface MessageRow {
  id: number;
  guid: string;
  chatId: number | null;
  text: string | null;
  attributedBody: Buffer | null;
  isFromMe: number;
  handleId: number;
  date: number | null;
  dateRead: number | null;
  service: string | null;
  isAudioMessage: number;
  hasAttachments: number;
  threadOriginatorGuid: string | null;
  replyToGuid: string | null;
}

interface AttachmentRow {
  id: number;
  filename: string | null;
  mimeType: string | null;
  transferName: string | null;
  totalBytes: number;
}

/**
 * Extract plain text from an NSArchiver-encoded attributedBody blob.
 * The binary contains an NSMutableAttributedString with the text
 * embedded after an "NSString" marker.
 */
export function extractTextFromAttributedBody(data: Buffer): string | null {
  const marker = Buffer.from("NSString");
  const idx = data.indexOf(marker);
  if (idx === -1) return null;

  // After "NSString" there's a variable header before the text length.
  // Pattern: skip past marker, then look for the 5-byte sequence
  // \x01 <byte> \x84 \x01 + followed by a variable-length integer.
  let pos = idx + marker.length;

  // Scan forward to find the length-encoding byte sequence.
  // The header varies, so we search for the pattern where we can
  // read a length then extract text.
  while (pos < data.length - 2) {
    // Look for the start pattern: after various header bytes,
    // we'll find either a direct length byte or a multi-byte length.
    if (data[pos] === 0x01 && pos + 3 < data.length && data[pos + 2] === 0x84) {
      // Skip the 5-byte header: \x01 <byte> \x84 \x01 +
      pos += 5;
      if (pos >= data.length) return null;

      // Read variable-length integer
      const lengthByte = data[pos] ?? 0;
      let textLength: number;

      if (lengthByte < 0x80) {
        textLength = lengthByte;
        pos += 1;
      } else if (lengthByte === 0x81) {
        if (pos + 2 >= data.length) return null;
        textLength = data.readUInt16LE(pos + 1);
        pos += 3;
      } else if (lengthByte === 0x82) {
        if (pos + 3 >= data.length) return null;
        textLength =
          (data[pos + 1] ?? 0) |
          ((data[pos + 2] ?? 0) << 8) |
          ((data[pos + 3] ?? 0) << 16);
        pos += 4;
      } else if (lengthByte === 0x83) {
        if (pos + 4 >= data.length) return null;
        textLength = data.readUInt32LE(pos + 1);
        pos += 5;
      } else {
        pos++;
        continue;
      }

      if (pos + textLength > data.length) return null;
      return data.subarray(pos, pos + textLength).toString("utf-8");
    }
    pos++;
  }

  return null;
}

export class MessageReader {
  private db: Database;
  private handleCache: Map<number, { identifier: string; service: string }> =
    new Map();

  constructor(db: Database) {
    this.db = db;
    this.buildCaches();
  }

  private buildCaches(): void {
    const handles = this.db.query(Q.LIST_HANDLES).all() as HandleRow[];
    for (const h of handles) {
      this.handleCache.set(h.id, {
        identifier: h.identifier,
        service: h.service,
      });
    }
  }

  private getMessageText(row: MessageRow): string {
    if (row.text) return row.text;
    if (row.attributedBody) {
      const buf = Buffer.isBuffer(row.attributedBody)
        ? row.attributedBody
        : Buffer.from(row.attributedBody);
      return extractTextFromAttributedBody(buf) ?? "";
    }
    return "";
  }

  private rowToMessageMeta(row: MessageRow): MessageMeta {
    const handle = this.handleCache.get(row.handleId);
    return {
      id: row.id,
      guid: row.guid,
      chatId: row.chatId ?? 0,
      text: this.getMessageText(row),
      isFromMe: row.isFromMe === 1,
      senderHandle: row.isFromMe === 1 ? "me" : (handle?.identifier ?? ""),
      date: Q.macNanosToDate(row.date),
      dateRead: row.dateRead ? Q.macNanosToDate(row.dateRead) : null,
      service: row.service ?? "",
      isAudioMessage: row.isAudioMessage === 1,
      hasAttachments: row.hasAttachments === 1,
      threadOriginatorGuid: row.threadOriginatorGuid ?? null,
      replyToGuid: row.replyToGuid ?? null,
    };
  }

  private getChatParticipants(chatId: number): string[] {
    const rows = this.db
      .query(Q.LIST_CHAT_PARTICIPANTS)
      .all(chatId) as ParticipantRow[];
    return rows.map((r) => r.identifier);
  }

  private rowToChat(row: ChatRow): Chat {
    const participants = this.getChatParticipants(row.id);
    return {
      id: row.id,
      guid: row.guid,
      displayName: row.displayName || row.chatIdentifier,
      chatIdentifier: row.chatIdentifier,
      isGroup: row.style === 43,
      serviceName: row.serviceName,
      participants,
      lastMessageDate: Q.macNanosToDate(row.lastMessageDate),
    };
  }

  listHandles(): Handle[] {
    const rows = this.db.query(Q.LIST_HANDLES).all() as HandleRow[];
    return rows.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      service: r.service,
    }));
  }

  listChats(options?: ListChatsOptions): Chat[] {
    const rows = this.db.query(Q.LIST_CHATS).all() as ChatRow[];
    let results = rows.map((r) => this.rowToChat(r));

    if (options?.search) {
      const q = options.search.toLowerCase();
      results = results.filter(
        (c) =>
          c.displayName.toLowerCase().includes(q) ||
          c.chatIdentifier.toLowerCase().includes(q) ||
          c.participants.some((p) => p.toLowerCase().includes(q)),
      );
    }

    const sortBy = options?.sortBy ?? "lastMessageDate";
    const order = options?.order ?? "desc";
    const mul = order === "asc" ? 1 : -1;

    results.sort((a, b) => {
      switch (sortBy) {
        case "displayName":
          return mul * a.displayName.localeCompare(b.displayName);
        default:
          return (
            mul * (a.lastMessageDate.getTime() - b.lastMessageDate.getTime())
          );
      }
    });

    if (options?.limit != null && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getChat(chatId: number): Chat | null {
    const row = this.db.query(Q.GET_CHAT).get(chatId) as ChatRow | null;
    if (!row) return null;
    return this.rowToChat(row);
  }

  listMessages(chatId: number, options?: ListMessagesOptions): MessageMeta[] {
    const rows = this.db.query(Q.LIST_MESSAGES).all(chatId) as MessageRow[];

    let results = rows.map((r) => this.rowToMessageMeta(r));

    if (options?.beforeDate) {
      const before = options.beforeDate.getTime();
      results = results.filter((m) => m.date.getTime() < before);
    }

    if (options?.afterDate) {
      const after = options.afterDate.getTime();
      results = results.filter((m) => m.date.getTime() > after);
    }

    if (options?.fromMe !== undefined) {
      results = results.filter((m) => m.isFromMe === options.fromMe);
    }

    const order = options?.order ?? "desc";
    const mul = order === "asc" ? 1 : -1;
    results.sort((a, b) => mul * (a.date.getTime() - b.date.getTime()));

    if (options?.limit != null && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getMessage(messageId: number): MessageMeta | null {
    const row = this.db
      .query(Q.GET_MESSAGE)
      .get(messageId) as MessageRow | null;
    if (!row) return null;
    return this.rowToMessageMeta(row);
  }

  searchMessages(
    query: string,
    options?: SearchMessagesOptions,
  ): MessageMeta[] {
    const pattern = `%${query}%`;
    const limit = options?.limit ?? 50;

    let rows: MessageRow[];
    if (options?.chatId != null) {
      rows = this.db
        .query(Q.SEARCH_MESSAGES_IN_CHAT)
        .all(pattern, options.chatId, limit) as MessageRow[];
    } else {
      rows = this.db
        .query(Q.SEARCH_MESSAGES)
        .all(pattern, limit) as MessageRow[];
    }

    return rows.map((r) => this.rowToMessageMeta(r));
  }

  listAttachments(messageId: number): MessageAttachment[] {
    const rows = this.db
      .query(Q.LIST_MESSAGE_ATTACHMENTS)
      .all(messageId) as AttachmentRow[];

    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      transferName: r.transferName,
      totalBytes: r.totalBytes ?? 0,
    }));
  }
}
