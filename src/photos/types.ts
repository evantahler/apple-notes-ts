export type PhotoId = number;
export type AlbumId = number;

export type MediaType = "photo" | "video";

export interface PhotoMeta {
  id: PhotoId;
  filename: string;
  mediaType: MediaType;
  width: number;
  height: number;
  dateCreated: Date;
  dateAdded: Date;
  modifiedAt: Date;
  fileSize: number | null;
  favorite: boolean;
  hidden: boolean;
  latitude: number | null;
  longitude: number | null;
}

export interface PhotoDetails extends PhotoMeta {
  uuid: string;
  uniformTypeIdentifier: string;
  duration: number;
  orientation: number;
  originalFilename: string | null;
  title: string | null;
  locallyAvailable: boolean;
}

export interface Album {
  id: AlbumId;
  title: string;
  kind: "user" | "smart";
  photoCount: number;
  createdAt: Date;
  modifiedAt: Date;
}

export interface AlbumContents extends Album {
  photoIds: PhotoId[];
}

export type PhotoSortField = "dateCreated" | "dateAdded";

import type { SortOrder } from "../types.ts";

export type { SortOrder };

export interface ListPhotosOptions {
  mediaType?: MediaType;
  favorite?: boolean;
  hidden?: boolean;
  albumId?: AlbumId;
  afterDate?: Date;
  beforeDate?: Date;
  limit?: number;
  sortBy?: PhotoSortField;
  order?: SortOrder;
}

export interface ListAlbumsOptions {
  search?: string;
  limit?: number;
}

export interface SearchPhotosOptions {
  limit?: number;
  mediaType?: MediaType;
}
