import type { Database } from "bun:sqlite";
import { openFullDiskAccessSettings } from "../errors.ts";
import {
  isDrawingAttachment,
  isFileBackedAttachment,
} from "./attachments/content-types.ts";
import {
  AttachmentResolver,
  type ResolveResult,
} from "./attachments/resolver.ts";
import { noteToMarkdown } from "./conversion/proto-to-markdown.ts";
import { openDatabase } from "./database/connection.ts";
import { NoteReader } from "./database/reader.ts";
import {
  DrawingImageNotAvailableError,
  NoteNotFoundError,
  PasswordProtectedError,
} from "./errors.ts";
import { collectDrawingRuns, type DrawingRun } from "./handwriting/drawings.ts";
import {
  loadImageBase64,
  MAX_INLINE_IMAGE_BYTES,
} from "./handwriting/image.ts";
import {
  type DecodedTable,
  decodeMergeableTable,
  decodeNoteData,
} from "./protobuf/decode.ts";
import type {
  Account,
  AttachmentRef,
  DrawingRef,
  DrawingResult,
  Folder,
  ListAttachmentsOptions,
  ListNotesOptions,
  NoteContent,
  NoteContentPage,
  NoteContentWithHandwriting,
  NoteMeta,
  PaginationOptions,
  ReadOptions,
  SearchOptions,
} from "./types.ts";

export interface NotesOptions {
  dbPath?: string;
  containerPath?: string;
}

export class Notes {
  private db: Database;
  private reader: NoteReader;
  private attachmentResolver: AttachmentResolver;

  constructor(options?: NotesOptions) {
    this.db = openDatabase(options?.dbPath);
    this.reader = new NoteReader(this.db);
    this.attachmentResolver = new AttachmentResolver(options?.containerPath);
  }

  search(query: string, options?: SearchOptions): NoteMeta[] {
    return this.reader.search(query, options);
  }

  read(noteId: number, options?: ReadOptions): NoteContent;
  read(
    noteId: number,
    pagination: PaginationOptions,
    options?: ReadOptions,
  ): NoteContentPage;
  read(
    noteId: number,
    paginationOrOptions?: PaginationOptions | ReadOptions,
    maybeOptions?: ReadOptions,
  ): NoteContent | NoteContentPage {
    // Disambiguate: a PaginationOptions has offset|limit; a ReadOptions has
    // attachmentLinkBuilder. The single-arg form may be either.
    let pagination: PaginationOptions | undefined;
    let options: ReadOptions | undefined;
    if (paginationOrOptions) {
      if ("offset" in paginationOrOptions || "limit" in paginationOrOptions) {
        pagination = paginationOrOptions as PaginationOptions;
        options = maybeOptions;
      } else {
        options = paginationOrOptions as ReadOptions;
      }
    }

    const result = this.reader.getNote(noteId);
    if (!result) throw new NoteNotFoundError(noteId);

    const { meta, zdata } = result;

    if (meta.isPasswordProtected) {
      throw new PasswordProtectedError(noteId);
    }

    let markdown = "";
    if (zdata) {
      const decoded = decodeNoteData(zdata);
      const tables = this.resolveTableAttachments(decoded);
      const attachments = options?.attachmentLinkBuilder
        ? this.listAttachments(noteId, { includeInlineAttachments: true })
        : undefined;
      markdown = noteToMarkdown(decoded, tables, attachments, options);
    }

    if (pagination) {
      const lines = markdown.split("\n");
      const offset = pagination.offset ?? 0;
      const limit = pagination.limit ?? 200;
      const pageLines = lines.slice(offset, offset + limit);

      return {
        meta,
        markdown: pageLines.join("\n"),
        offset,
        limit,
        totalLines: lines.length,
        hasMore: offset + limit < lines.length,
      };
    }

    return { meta, markdown };
  }

  accounts(): Account[] {
    return this.reader.listAccounts();
  }

  folders(account?: string): Folder[] {
    return this.reader.listFolders(account);
  }

  notes(options?: ListNotesOptions): NoteMeta[] {
    return this.reader.listNotes(options).map((r) => r.meta);
  }

  listAttachments(
    noteId: number,
    options?: ListAttachmentsOptions,
  ): AttachmentRef[] {
    const refs = this.reader.listAttachments(noteId);
    // Handwriting uses listDrawings / readWithHandwriting — drawing rows have no
    // useful filename and resolve via FallbackImages, not the usual Media path.
    const withoutDrawings = refs.filter(
      (r) => !isDrawingAttachment(r.contentType),
    );
    const filtered = options?.includeInlineAttachments
      ? withoutDrawings
      : withoutDrawings.filter((r) => isFileBackedAttachment(r.contentType));
    return filtered.map((ref) => ({
      ...ref,
      url: this.getAttachmentUrl(ref.identifier || ref.name),
    }));
  }

  getAttachmentUrl(attachmentId: string): string | null {
    // Follow the ZMEDIA FK first — the file on disk uses the media row's
    // identifier (a different UUID), and this avoids matching thumbnails
    const media = this.reader.resolveMediaIdentifier(attachmentId);
    if (media) {
      const resolved = this.attachmentResolver.resolve(media.mediaIdentifier);
      if (resolved) return resolved;
    }

    // Fall back to resolving directly by the attachment identifier
    return this.attachmentResolver.resolve(attachmentId);
  }

  // Like getAttachmentUrl, but returns a structured result so callers can
  // distinguish "not-found" from "permission-denied". Returns the absolute
  // file path on success (no file:// prefix).
  resolveAttachment(attachmentId: string): ResolveResult {
    const media = this.reader.resolveMediaIdentifier(attachmentId);
    let firstError: ResolveResult | undefined;
    if (media) {
      const r = this.attachmentResolver.resolveDetailed(media.mediaIdentifier);
      if ("path" in r) return r;
      firstError = r;
    }
    const second = this.attachmentResolver.resolveDetailed(attachmentId);
    if ("path" in second) return second;
    // Prefer permission-denied over not-found so an access problem on the
    // media path isn't masked by a not-found on the attachment-id fallback.
    if (
      firstError &&
      "error" in firstError &&
      firstError.error === "permission-denied"
    ) {
      return firstError;
    }
    return second;
  }

  // List the handwritten drawings (Apple Pencil / PencilKit) referenced by a
  // note, noting whether Apple's rendered image of each is available on disk.
  listDrawings(noteId: number): DrawingRef[] {
    const result = this.reader.getNote(noteId);
    if (!result) throw new NoteNotFoundError(noteId);
    if (result.meta.isPasswordProtected) {
      throw new PasswordProtectedError(noteId);
    }
    if (!result.zdata) return [];
    const decoded = decodeNoteData(result.zdata);
    return collectDrawingRuns(decoded).map((run) => {
      const resolved = this.resolveAttachment(run.identifier);
      const available = "path" in resolved;
      return {
        identifier: run.identifier,
        typeUti: run.typeUti,
        available,
        imagePath: available ? resolved.path : null,
      };
    });
  }

  // Resolve a single drawing's rendered image to a base64 PNG (plus path/size).
  // Returns null when no rendered image exists on disk. base64 is null when the
  // image exceeds the inline size cap (path is still returned).
  getDrawingImage(identifier: string): {
    path: string;
    base64: string | null;
    mimeType: string;
    bytes: number;
  } | null {
    const resolved = this.resolveAttachment(identifier);
    if (!("path" in resolved)) return null;
    const loaded = loadImageBase64(resolved.path);
    if ("tooLarge" in loaded) {
      return {
        path: resolved.path,
        base64: null,
        mimeType: "image/png",
        bytes: loaded.bytes,
      };
    }
    return {
      path: resolved.path,
      base64: loaded.base64,
      mimeType: loaded.mimeType,
      bytes: loaded.bytes,
    };
  }

  // Read a note's markdown and, for every handwritten drawing it contains,
  // resolve Apple's rendered image as a base64 PNG ready to hand to a vision
  // model. Scatter-gather: an unavailable or unreadable drawing is reported in
  // its DrawingResult (available=false, error set) rather than throwing.
  readWithHandwriting(noteId: number): NoteContentWithHandwriting {
    const result = this.reader.getNote(noteId);
    if (!result) throw new NoteNotFoundError(noteId);
    if (result.meta.isPasswordProtected) {
      throw new PasswordProtectedError(noteId);
    }

    let markdown = "";
    const drawings: DrawingResult[] = [];
    if (result.zdata) {
      const decoded = decodeNoteData(result.zdata);
      const tables = this.resolveTableAttachments(decoded);
      markdown = noteToMarkdown(decoded, tables);
      for (const run of collectDrawingRuns(decoded)) {
        drawings.push(this.buildDrawingResult(run));
      }
    }
    return { meta: result.meta, markdown, drawings };
  }

  private buildDrawingResult(run: DrawingRun): DrawingResult {
    try {
      const img = this.getDrawingImage(run.identifier);
      if (!img) {
        const err = new DrawingImageNotAvailableError(run.identifier);
        return {
          identifier: run.identifier,
          typeUti: run.typeUti,
          available: false,
          error: `${err.message}. ${err.recovery}`,
        };
      }
      if (img.base64 === null) {
        return {
          identifier: run.identifier,
          typeUti: run.typeUti,
          available: true,
          imagePath: img.path,
          mimeType: img.mimeType,
          bytes: img.bytes,
          error: `Image exceeds inline size cap (${MAX_INLINE_IMAGE_BYTES} bytes); use imagePath to read from disk`,
        };
      }
      return {
        identifier: run.identifier,
        typeUti: run.typeUti,
        available: true,
        imagePath: img.path,
        base64: img.base64,
        mimeType: img.mimeType,
        bytes: img.bytes,
      };
    } catch (e) {
      return {
        identifier: run.identifier,
        typeUti: run.typeUti,
        available: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private resolveTableAttachments(
    decoded: import("./protobuf/decode.ts").DecodedNote,
  ): Map<string, DecodedTable> | undefined {
    const tableRuns = decoded.attributeRuns.filter(
      (r) =>
        r.attachmentInfo?.typeUti === "com.apple.notes.table" &&
        r.attachmentInfo.attachmentIdentifier,
    );
    if (tableRuns.length === 0) return undefined;

    const tables = new Map<string, DecodedTable>();
    for (const run of tableRuns) {
      const id = run.attachmentInfo?.attachmentIdentifier;
      if (!id) continue;
      const blob = this.reader.getTableData(id);
      if (!blob) continue;
      const table = decodeMergeableTable(blob);
      if (table) tables.set(id, table);
    }
    return tables.size > 0 ? tables : undefined;
  }

  close(): void {
    this.db.close();
  }

  static requestAccess(): void {
    openFullDiskAccessSettings();
  }
}
