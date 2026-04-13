import type { Database } from "bun:sqlite";
import { AttachmentResolver } from "./attachments/resolver.ts";
import { noteToMarkdown } from "./conversion/proto-to-markdown.ts";
import { openDatabase } from "./database/connection.ts";
import { NoteReader } from "./database/reader.ts";
import { NoteNotFoundError, PasswordProtectedError } from "./errors.ts";
import {
  type DecodedTable,
  decodeMergeableTable,
  decodeNoteData,
} from "./protobuf/decode.ts";
import type {
  Account,
  AttachmentRef,
  Folder,
  ListNotesOptions,
  NoteContent,
  NoteContentPage,
  NoteMeta,
  PaginationOptions,
  SearchOptions,
} from "./types.ts";

export interface AppleNotesOptions {
  dbPath?: string;
  containerPath?: string;
}

export class AppleNotes {
  private db: Database;
  private reader: NoteReader;
  private attachmentResolver: AttachmentResolver;

  constructor(options?: AppleNotesOptions) {
    this.db = openDatabase(options?.dbPath);
    this.reader = new NoteReader(this.db);
    this.attachmentResolver = new AttachmentResolver(options?.containerPath);
  }

  search(query: string, options?: SearchOptions): NoteMeta[] {
    return this.reader.search(query, options);
  }

  read(noteId: number): NoteContent;
  read(noteId: number, pagination: PaginationOptions): NoteContentPage;
  read(
    noteId: number,
    pagination?: PaginationOptions,
  ): NoteContent | NoteContentPage {
    const result = this.reader.getNote(noteId);
    if (!result) throw new NoteNotFoundError(noteId);

    const { meta, zdata } = result;

    if (meta.isPasswordProtected) {
      throw new PasswordProtectedError(noteId);
    }

    let markdown = "";
    if (zdata) {
      const decoded = decodeNoteData(zdata);
      const tables = this.resolveTableAttachments(decoded);
      markdown = noteToMarkdown(decoded, tables);
    }

    if (pagination) {
      const lines = markdown.split("\n");
      const offset = pagination.offset ?? 0;
      const limit = pagination.limit ?? 200;
      const pageLines = lines.slice(offset, offset + limit);

      return {
        meta,
        markdown: pageLines.join("\n"),
        offset,
        limit,
        totalLines: lines.length,
        hasMore: offset + limit < lines.length,
      };
    }

    return { meta, markdown };
  }

  accounts(): Account[] {
    return this.reader.listAccounts();
  }

  folders(account?: string): Folder[] {
    return this.reader.listFolders(account);
  }

  notes(options?: ListNotesOptions): NoteMeta[] {
    return this.reader.listNotes(options).map((r) => r.meta);
  }

  listAttachments(noteId: number): AttachmentRef[] {
    const refs = this.reader.listAttachments(noteId);
    return refs.map((ref) => ({
      ...ref,
      url: this.getAttachmentUrl(ref.identifier || ref.name),
    }));
  }

  getAttachmentUrl(attachmentId: string): string | null {
    // Follow the ZMEDIA FK first — the file on disk uses the media row's
    // identifier (a different UUID), and this avoids matching thumbnails
    const media = this.reader.resolveMediaIdentifier(attachmentId);
    if (media) {
      const resolved = this.attachmentResolver.resolve(media.mediaIdentifier);
      if (resolved) return resolved;
    }

    // Fall back to resolving directly by the attachment identifier
    return this.attachmentResolver.resolve(attachmentId);
  }

  private resolveTableAttachments(
    decoded: import("./protobuf/decode.ts").DecodedNote,
  ): Map<string, DecodedTable> | undefined {
    const tableRuns = decoded.attributeRuns.filter(
      (r) =>
        r.attachmentInfo?.typeUti === "com.apple.notes.table" &&
        r.attachmentInfo.attachmentIdentifier,
    );
    if (tableRuns.length === 0) return undefined;

    const tables = new Map<string, DecodedTable>();
    for (const run of tableRuns) {
      const id = run.attachmentInfo?.attachmentIdentifier;
      if (!id) continue;
      const blob = this.reader.getTableData(id);
      if (!blob) continue;
      const table = decodeMergeableTable(blob);
      if (table) tables.set(id, table);
    }
    return tables.size > 0 ? tables : undefined;
  }

  close(): void {
    this.db.close();
  }

  static requestAccess(): void {
    Bun.spawn([
      "open",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    ]);
  }
}
