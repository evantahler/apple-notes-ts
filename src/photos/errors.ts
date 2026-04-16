import { MacOSError } from "../errors.ts";

export class PhotoNotFoundError extends MacOSError {
  constructor(photoId: number) {
    super(`Photo not found: ${photoId}`, {
      category: "not_found",
      recovery: "Use list_photos or search_photos to find valid photo IDs.",
    });
    this.name = "PhotoNotFoundError";
  }
}

export class AlbumNotFoundError extends MacOSError {
  constructor(albumId: number) {
    super(`Album not found: ${albumId}`, {
      category: "not_found",
      recovery: "Use list_albums to find valid album IDs.",
    });
    this.name = "AlbumNotFoundError";
  }
}
