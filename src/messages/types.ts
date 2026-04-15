export type HandleId = number;
export type ChatId = number;
export type MessageId = number;
export type AttachmentId = number;

export interface Handle {
  id: HandleId;
  identifier: string;
  service: string;
}

export interface Chat {
  id: ChatId;
  guid: string;
  displayName: string;
  chatIdentifier: string;
  isGroup: boolean;
  serviceName: string;
  participants: string[];
  lastMessageDate: Date;
}

export interface MessageMeta {
  id: MessageId;
  guid: string;
  chatId: ChatId;
  text: string;
  isFromMe: boolean;
  senderHandle: string;
  date: Date;
  dateRead: Date | null;
  service: string;
  isAudioMessage: boolean;
  hasAttachments: boolean;
  threadOriginatorGuid: string | null;
  replyToGuid: string | null;
}

export interface MessageAttachment {
  id: AttachmentId;
  filename: string | null;
  mimeType: string | null;
  transferName: string | null;
  totalBytes: number;
}

export type ChatSortField = "lastMessageDate" | "displayName";

import type { SortOrder } from "../types.ts";

export type { SortOrder };

export interface ListChatsOptions {
  search?: string;
  limit?: number;
  sortBy?: ChatSortField;
  order?: SortOrder;
}

export interface ListMessagesOptions {
  limit?: number;
  beforeDate?: Date;
  afterDate?: Date;
  fromMe?: boolean;
  order?: SortOrder;
}

export interface SearchMessagesOptions {
  chatId?: number;
  limit?: number;
}
