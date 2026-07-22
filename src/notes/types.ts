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

// A handwritten-drawing attachment in a note (Apple Pencil / PencilKit).
export interface DrawingRef {
  identifier: string;
  typeUti: string;
  // Whether Apple's rendered image of this drawing exists on disk. False when
  // the note hasn't been rendered locally or the media is iCloud-only.
  available: boolean;
  imagePath: string | null;
}

// A drawing plus its resolved rendered image. Produced by readWithHandwriting,
// which is scatter-gather: an unavailable/unreadable drawing sets `available`
// false and an `error` string rather than failing the whole call.
export interface DrawingResult {
  identifier: string;
  typeUti: string;
  available: boolean;
  imagePath?: string;
  // base64-encoded PNG of the handwriting, ready to hand to a vision model.
  // Omitted when unavailable or when the image exceeds the inline size cap
  // (imagePath is still set in the latter case, with `error` explaining why).
  base64?: string;
  mimeType?: string;
  bytes?: number;
  // Set when unavailable, or when the on-disk image exceeds the inline cap.
  error?: string;
}

export interface NoteContentWithHandwriting {
  meta: NoteMeta;
  markdown: string;
  drawings: DrawingResult[];
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
