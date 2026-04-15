import { MacOSError } from "../errors.ts";

export class NoteNotFoundError extends MacOSError {
  constructor(noteId: number) {
    super(`Note not found: ${noteId}`);
    this.name = "NoteNotFoundError";
  }
}

export class PasswordProtectedError extends MacOSError {
  constructor(noteId: number) {
    super(`Note is password protected and cannot be read: ${noteId}`);
    this.name = "PasswordProtectedError";
  }
}
