import { MacOSError } from "../errors.ts";

export class NoteNotFoundError extends MacOSError {
  constructor(noteId: number) {
    super(`Note not found: ${noteId}`, {
      category: "not_found",
      recovery: "Use list_notes or search_notes to find valid note IDs.",
    });
    this.name = "NoteNotFoundError";
  }
}

export class PasswordProtectedError extends MacOSError {
  constructor(noteId: number) {
    super(`Note is password protected and cannot be read: ${noteId}`, {
      category: "access_denied",
      recovery:
        "This note is password-protected and cannot be read via the database.",
    });
    this.name = "PasswordProtectedError";
  }
}

export class DrawingImageNotAvailableError extends MacOSError {
  constructor(identifier: string) {
    super(`Handwriting image not available on disk: ${identifier}`, {
      category: "not_found",
      recovery:
        "Apple renders a handwritten drawing to an image only after the note is opened in Notes.app, and iCloud may purge it under Optimize Storage. Open the note in Notes.app on this Mac (and disable Optimize Storage) so the image is rendered locally, then retry.",
    });
    this.name = "DrawingImageNotAvailableError";
  }
}
