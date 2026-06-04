import type { Database } from "bun:sqlite";
import { openFullDiskAccessSettings } from "../errors.ts";
import { openDatabase } from "./database/connection.ts";
import { MessageReader } from "./database/reader.ts";
import { ChatNotFoundError, MessageNotFoundError } from "./errors.ts";
import { buildSendArgs, classifySendError, SEND_APPLESCRIPT } from "./send.ts";
import type {
  Chat,
  Handle,
  ListChatsOptions,
  ListMessagesOptions,
  MessageAttachment,
  MessageMeta,
  SearchMessagesOptions,
  SendMessageOptions,
  SendMessageResult,
} from "./types.ts";

export interface MessagesOptions {
  dbPath?: string;
}

export class Messages {
  private db: Database;
  private reader: MessageReader;

  constructor(options?: MessagesOptions) {
    this.db = openDatabase(options?.dbPath);
    this.reader = new MessageReader(this.db);
  }

  handles(): Handle[] {
    return this.reader.listHandles();
  }

  chats(options?: ListChatsOptions): Chat[] {
    return this.reader.listChats(options);
  }

  getChat(chatId: number): Chat {
    const chat = this.reader.getChat(chatId);
    if (!chat) throw new ChatNotFoundError(chatId);
    return chat;
  }

  messages(chatId: number, options?: ListMessagesOptions): MessageMeta[] {
    const chat = this.reader.getChat(chatId);
    if (!chat) throw new ChatNotFoundError(chatId);
    return this.reader.listMessages(chatId, options);
  }

  getMessage(messageId: number): MessageMeta {
    const message = this.reader.getMessage(messageId);
    if (!message) throw new MessageNotFoundError(messageId);
    return message;
  }

  search(query: string, options?: SearchMessagesOptions): MessageMeta[] {
    return this.reader.searchMessages(query, options);
  }

  attachments(messageId: number): MessageAttachment[] {
    return this.reader.listAttachments(messageId);
  }

  /**
   * Sends an iMessage/SMS by driving Messages.app through Apple Events
   * (`osascript -l JavaScript`). This is the only non-read-only operation in the
   * package: the message cannot be unsent, and macOS gives no delivery
   * confirmation (a successful return means osascript dispatched the request, not
   * that it was delivered). The first call prompts for Automation permission.
   *
   * Target either an existing conversation (`chatId`, from {@link chats}) or a
   * raw `handle` (phone/email). Throws `ChatNotFoundError` for an unknown
   * `chatId`, `MacOSError` (`invalid_input`) for bad arguments, and
   * `MessageSendError` if osascript fails.
   */
  send(options: SendMessageOptions): SendMessageResult {
    // Resolve the chat (and validate it exists) before building args. Skipped
    // when a handle is also supplied so buildSendArgs can report the conflict.
    const chat =
      options.chatId !== undefined && options.handle === undefined
        ? this.getChat(options.chatId)
        : undefined;

    const { target, service, mode } = buildSendArgs(options, chat);

    const result = Bun.spawnSync(
      [
        "osascript",
        "-e",
        SEND_APPLESCRIPT,
        target,
        options.text,
        service,
        mode,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    if (result.exitCode !== 0) {
      throw classifySendError(result.exitCode ?? -1, result.stderr.toString());
    }

    return { to: target, service, mode };
  }

  close(): void {
    this.db.close();
  }

  static requestAccess(): void {
    openFullDiskAccessSettings();
  }
}
