import type { Database } from "bun:sqlite";
import { openFullDiskAccessSettings } from "../errors.ts";
import { openDatabase } from "./database/connection.ts";
import { PhotoReader } from "./database/reader.ts";
import { AlbumNotFoundError, PhotoNotFoundError } from "./errors.ts";
import type {
  Album,
  AlbumContents,
  ListAlbumsOptions,
  ListPhotosOptions,
  PhotoDetails,
  PhotoMeta,
  SearchPhotosOptions,
} from "./types.ts";

export interface PhotosOptions {
  dbPath?: string;
}

export class Photos {
  private db: Database;
  private reader: PhotoReader;

  constructor(options?: PhotosOptions) {
    this.db = openDatabase(options?.dbPath);
    this.reader = new PhotoReader(this.db, this.db.filename);
  }

  photos(options?: ListPhotosOptions): PhotoMeta[] {
    return this.reader.listPhotos(options);
  }

  getPhoto(photoId: number): PhotoDetails {
    const photo = this.reader.getPhoto(photoId);
    if (!photo) throw new PhotoNotFoundError(photoId);
    return photo;
  }

  getPhotoUrl(photoId: number): { url: string; locallyAvailable: boolean } {
    const result = this.reader.getPhotoUrl(photoId);
    if (!result) throw new PhotoNotFoundError(photoId);
    return result;
  }

  albums(options?: ListAlbumsOptions): Album[] {
    return this.reader.listAlbums(options);
  }

  getAlbum(albumId: number): AlbumContents {
    const album = this.reader.getAlbum(albumId);
    if (!album) throw new AlbumNotFoundError(albumId);
    return album;
  }

  search(query: string, options?: SearchPhotosOptions): PhotoMeta[] {
    return this.reader.searchPhotos(query, options);
  }

  close(): void {
    this.db.close();
  }

  static requestAccess(): void {
    openFullDiskAccessSettings();
  }
}
