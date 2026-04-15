import type { Database } from "bun:sqlite";
import { openFullDiskAccessSettings } from "../errors.ts";
import { openDatabase } from "./database/connection.ts";
import { MessageReader } from "./database/reader.ts";
import { ChatNotFoundError, MessageNotFoundError } from "./errors.ts";
import type {
  Chat,
  Handle,
  ListChatsOptions,
  ListMessagesOptions,
  MessageAttachment,
  MessageMeta,
  SearchMessagesOptions,
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

  close(): void {
    this.db.close();
  }

  static requestAccess(): void {
    openFullDiskAccessSettings();
  }
}
