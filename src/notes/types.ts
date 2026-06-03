export type NoteId = number;
export type FolderId = number;
export type AccountId = number;
export type AttachmentId = number;

export interface Account {
  id: AccountId;
  name: string;
}

export interface Folder {
  id: FolderId;
  name: string;
  accountId: AccountId;
  accountName: string;
  noteCount: number;
}

export interface NoteMeta {
  id: NoteId;
  title: string;
  snippet: string;
  folderId: FolderId;
  folderName: string;
  accountId: AccountId;
  accountName: string;
  createdAt: Date;
  modifiedAt: Date;
  isPasswordProtected: boolean;
}

export interface NoteContent {
  meta: NoteMeta;
  markdown: string;
}

export interface NoteContentPage {
  meta: NoteMeta;
  markdown: string;
  offset: number;
  limit: number;
  totalLines: number;
  hasMore: boolean;
}

export interface AttachmentRef {
  id: AttachmentId;
  identifier: string;
  name: string;
  contentType: string;
  url: string | null;
}

// Info passed to a caller-supplied attachmentLinkBuilder when rendering
// markdown. The caller decides what URL/path to substitute for each attachment.
export interface AttachmentLinkInfo {
  identifier: string;
  name: string;
  contentType: string;
}

export interface ReadOptions {
  // When provided, attachments in rendered markdown become
  // `![${name}](${builder(info)})` instead of the default
  // `![attachment](attachment:${id}?type=${uti})` placeholder URI.
  attachmentLinkBuilder?: (info: AttachmentLinkInfo) => string;
}

export type NoteSortField = "title" | "createdAt" | "modifiedAt";

import type { SortOrder } from "../types.ts";

export type { SortOrder };

export interface SearchOptions {
  folder?: string;
  limit?: number;
}

export interface ListNotesOptions {
  folder?: string;
  account?: string;
  search?: string;
  /**
   * Incremental-read filter: return notes whose modified date OR created date
   * is on or after this date. Deliberately over-inclusive — the OR also catches
   * iCloud notes whose modification timestamp was stamped on another device.
   */
  modifiedAfter?: Date;
  sortBy?: NoteSortField;
  order?: SortOrder;
  limit?: number;
}

export interface ListAttachmentsOptions {
  // Include inline attachments that have no on-disk file (tables, galleries,
  // hashtags, mentions, inline links, URL chips). Defaults to false.
  includeInlineAttachments?: boolean;
}

export interface PaginationOptions {
  offset?: number;
  limit?: number;
}
