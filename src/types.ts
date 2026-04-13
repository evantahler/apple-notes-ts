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

export type NoteSortField = "title" | "createdAt" | "modifiedAt";
export type SortOrder = "asc" | "desc";

export interface SearchOptions {
  folder?: string;
  limit?: number;
}

export interface ListNotesOptions {
  folder?: string;
  account?: string;
  search?: string;
  sortBy?: NoteSortField;
  order?: SortOrder;
  limit?: number;
}

export interface PaginationOptions {
  offset?: number;
  limit?: number;
}
