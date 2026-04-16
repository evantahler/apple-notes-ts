import type { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import type {
  Album,
  AlbumContents,
  ListAlbumsOptions,
  ListPhotosOptions,
  MediaType,
  PhotoDetails,
  PhotoMeta,
  SearchPhotosOptions,
} from "../types.ts";
import * as Q from "./queries.ts";

interface PhotoRow {
  id: number;
  filename: string;
  kind: number;
  width: number;
  height: number;
  dateCreated: number | null;
  dateAdded: number | null;
  favorite: number;
  hidden: number;
  latitude: number | null;
  longitude: number | null;
}

interface PhotoDetailRow extends PhotoRow {
  uuid: string;
  uniformTypeIdentifier: string | null;
  duration: number | null;
  orientation: number | null;
  originalFilename: string | null;
  title: string | null;
  fileSize: number | null;
}

interface AlbumRow {
  id: number;
  title: string | null;
  kind: number;
  photoCount: number | null;
  createdAt: number | null;
  modifiedAt: number | null;
}

export class PhotoReader {
  private db: Database;
  private libraryPath: string;

  constructor(db: Database, dbPath: string) {
    this.db = db;
    // Photos.sqlite is at <library>/database/Photos.sqlite
    // originals are at <library>/originals/
    this.libraryPath = dirname(dirname(dbPath));
  }

  private kindToMediaType(kind: number): MediaType {
    return kind === 1 ? "video" : "photo";
  }

  private rowToPhotoMeta(row: PhotoRow): PhotoMeta {
    return {
      id: row.id,
      filename: row.filename ?? "",
      mediaType: this.kindToMediaType(row.kind),
      width: row.width ?? 0,
      height: row.height ?? 0,
      dateCreated: Q.macTimeToDate(row.dateCreated),
      dateAdded: Q.macTimeToDate(row.dateAdded),
      favorite: row.favorite === 1,
      hidden: row.hidden === 1,
      latitude: row.latitude && row.latitude !== 0 ? row.latitude : null,
      longitude: row.longitude && row.longitude !== 0 ? row.longitude : null,
    };
  }

  private rowToAlbum(row: AlbumRow): Album {
    return {
      id: row.id,
      title: row.title ?? "Untitled",
      kind: row.kind === 4000 ? "smart" : "user",
      photoCount: row.photoCount ?? 0,
      createdAt: Q.macTimeToDate(row.createdAt),
      modifiedAt: Q.macTimeToDate(row.modifiedAt),
    };
  }

  private applyPhotoFilters(
    photos: PhotoMeta[],
    options?: ListPhotosOptions,
  ): PhotoMeta[] {
    let results = photos;

    if (options?.mediaType != null) {
      results = results.filter((p) => p.mediaType === options.mediaType);
    }

    if (options?.favorite != null) {
      results = results.filter((p) => p.favorite === options.favorite);
    }

    if (options?.hidden != null) {
      results = results.filter((p) => p.hidden === options.hidden);
    } else {
      // By default exclude hidden photos
      results = results.filter((p) => !p.hidden);
    }

    if (options?.afterDate != null) {
      const after = options.afterDate.getTime();
      results = results.filter((p) => p.dateCreated.getTime() >= after);
    }

    if (options?.beforeDate != null) {
      const before = options.beforeDate.getTime();
      results = results.filter((p) => p.dateCreated.getTime() <= before);
    }

    return results;
  }

  private sortPhotos(
    photos: PhotoMeta[],
    sortBy?: "dateCreated" | "dateAdded",
    order?: "asc" | "desc",
  ): PhotoMeta[] {
    const field = sortBy ?? "dateCreated";
    const mul = (order ?? "desc") === "asc" ? 1 : -1;

    return photos.sort((a, b) => {
      const aTime = a[field].getTime();
      const bTime = b[field].getTime();
      return mul * (aTime - bTime);
    });
  }

  listPhotos(options?: ListPhotosOptions): PhotoMeta[] {
    let rows: PhotoRow[];

    if (options?.albumId != null) {
      rows = this.db
        .query(Q.LIST_PHOTOS_IN_ALBUM)
        .all(options.albumId) as PhotoRow[];
    } else {
      rows = this.db.query(Q.LIST_PHOTOS).all() as PhotoRow[];
    }

    let results = rows.map((r) => this.rowToPhotoMeta(r));
    results = this.applyPhotoFilters(results, options);
    results = this.sortPhotos(results, options?.sortBy, options?.order);

    if (options?.limit != null && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getPhoto(photoId: number): PhotoDetails | null {
    const row = this.db
      .query(Q.GET_PHOTO)
      .get(photoId) as PhotoDetailRow | null;
    if (!row) return null;

    // Check local availability
    const resourceRow = this.db
      .query(Q.CHECK_LOCAL_AVAILABILITY)
      .get(photoId) as { localAvailability: number } | null;
    const locallyAvailable = resourceRow?.localAvailability === 1;

    const meta = this.rowToPhotoMeta(row);
    return {
      ...meta,
      uuid: row.uuid,
      uniformTypeIdentifier: row.uniformTypeIdentifier ?? "public.jpeg",
      duration: row.duration ?? 0,
      orientation: row.orientation ?? 1,
      originalFilename: row.originalFilename,
      title: row.title,
      fileSize: row.fileSize,
      locallyAvailable,
    };
  }

  getPhotoUrl(
    photoId: number,
  ): { url: string; locallyAvailable: boolean } | null {
    const row = this.db
      .query(
        "SELECT ZDIRECTORY as directory, ZFILENAME as filename FROM ZASSET WHERE Z_PK = ? AND ZTRASHEDSTATE = 0",
      )
      .get(photoId) as {
      directory: string | null;
      filename: string | null;
    } | null;
    if (!row?.filename) return null;

    // Originals are stored at <library>/originals/<first-char-of-directory>/<filename>
    // When directory is "0" or a UUID-based path, first char is the bucket
    const dir = row.directory ?? "0";
    const bucket = dir.charAt(0);
    const filePath = join(this.libraryPath, "originals", bucket, row.filename);

    const resourceRow = this.db
      .query(Q.CHECK_LOCAL_AVAILABILITY)
      .get(photoId) as { localAvailability: number } | null;
    const locallyAvailable = resourceRow?.localAvailability === 1;

    return {
      url: `file://${filePath}`,
      locallyAvailable,
    };
  }

  listAlbums(options?: ListAlbumsOptions): Album[] {
    const rows = this.db.query(Q.LIST_ALBUMS).all() as AlbumRow[];
    let results = rows.map((r) => this.rowToAlbum(r));

    if (options?.search) {
      const q = options.search.toLowerCase();
      results = results.filter((a) => a.title.toLowerCase().includes(q));
    }

    if (options?.limit != null && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getAlbum(albumId: number): AlbumContents | null {
    const row = this.db.query(Q.GET_ALBUM).get(albumId) as AlbumRow | null;
    if (!row) return null;

    const photoRows = this.db.query(Q.GET_ALBUM_PHOTO_IDS).all(albumId) as {
      photoId: number;
    }[];
    const photoIds = photoRows.map((r) => r.photoId);

    return {
      ...this.rowToAlbum(row),
      photoIds,
    };
  }

  searchPhotos(query: string, options?: SearchPhotosOptions): PhotoMeta[] {
    const pattern = `%${query}%`;
    const rows = this.db
      .query(Q.SEARCH_PHOTOS)
      .all(pattern, pattern, pattern) as PhotoRow[];

    let results = rows.map((r) => this.rowToPhotoMeta(r));

    // Exclude hidden by default
    results = results.filter((p) => !p.hidden);

    if (options?.mediaType != null) {
      results = results.filter((p) => p.mediaType === options.mediaType);
    }

    const limit = options?.limit ?? 50;
    return results.slice(0, limit);
  }
}
