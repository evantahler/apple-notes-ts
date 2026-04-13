import type { Database } from "bun:sqlite";
import type {
  Account,
  AttachmentRef,
  Folder,
  ListNotesOptions,
  NoteMeta,
  SearchOptions,
} from "../types.ts";
import type { DateColumns } from "./queries.ts";
import * as Q from "./queries.ts";

interface EntityTypes {
  account: number;
  folder: number;
  note: number;
  attachment: number;
}

interface ColumnInfoRow {
  name: string;
}

interface NoteRow {
  id: number;
  title: string | null;
  snippet: string | null;
  folderId: number | null;
  createdAt: number | null;
  modifiedAt: number | null;
  isPasswordProtected: number | null;
  zdata?: Buffer | null;
  noteDataId?: number | null;
}

interface FolderRow {
  id: number;
  name: string | null;
  accountId: number | null;
}

interface AccountRow {
  id: number;
  name: string | null;
}

interface AttachmentRow {
  id: number;
  identifier: string | null;
  name: string | null;
  contentType: string | null;
  noteId: number | null;
}

interface EntityTypeRow {
  Z_ENT: number;
  Z_NAME: string;
}

export class NoteReader {
  private db: Database;
  private entityTypes: EntityTypes;
  private dateColumns: DateColumns;
  private folderCache: Map<number, { name: string; accountId: number }> =
    new Map();
  private accountCache: Map<number, string> = new Map();

  constructor(db: Database) {
    this.db = db;
    this.entityTypes = this.discoverEntityTypes();
    this.dateColumns = this.discoverDateColumns();
    this.buildCaches();
  }

  private discoverEntityTypes(): EntityTypes {
    const rows = this.db.query(Q.GET_ENTITY_TYPES).all() as EntityTypeRow[];
    const types: Partial<EntityTypes> = {};

    for (const row of rows) {
      switch (row.Z_NAME) {
        case "ICAccount":
          types.account = row.Z_ENT;
          break;
        case "ICFolder":
          types.folder = row.Z_ENT;
          break;
        case "ICNote":
          types.note = row.Z_ENT;
          break;
        case "ICAttachment":
          types.attachment = row.Z_ENT;
          break;
      }
    }

    return {
      account: types.account ?? 0,
      folder: types.folder ?? 0,
      note: types.note ?? 0,
      attachment: types.attachment ?? 0,
    };
  }

  private discoverDateColumns(): DateColumns {
    const rows = this.db
      .query("PRAGMA table_info(ZICCLOUDSYNCINGOBJECT)")
      .all() as ColumnInfoRow[];
    const columns = rows.map((r) => r.name);

    // Core Data column suffixes vary by macOS version.
    // Find all matching date columns, then pick the one with actual data.
    const creationCols = columns.filter((c) => c.startsWith("ZCREATIONDATE"));
    const modificationCols = columns.filter((c) =>
      c.startsWith("ZMODIFICATIONDATE"),
    );

    return {
      createdAt: this.pickDateColumn(creationCols) ?? "ZCREATIONDATE1",
      modifiedAt: this.pickDateColumn(modificationCols) ?? "ZMODIFICATIONDATE1",
    };
  }

  private pickDateColumn(candidates: string[]): string | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0] ?? null;

    // Multiple columns exist — pick the one that has non-NULL data
    for (const col of candidates) {
      const row = this.db
        .query(
          `SELECT ${col} as v FROM ZICCLOUDSYNCINGOBJECT WHERE ${col} IS NOT NULL LIMIT 1`,
        )
        .get() as { v: number } | null;
      if (row) return col;
    }

    return candidates[0] ?? null;
  }

  private buildCaches(): void {
    const folders = this.db
      .query(Q.LIST_FOLDERS)
      .all(this.entityTypes.folder) as FolderRow[];
    for (const f of folders) {
      this.folderCache.set(f.id, {
        name: f.name ?? "",
        accountId: f.accountId ?? 0,
      });
    }

    const accounts = this.db
      .query(Q.LIST_ACCOUNTS)
      .all(this.entityTypes.account) as AccountRow[];
    for (const a of accounts) {
      this.accountCache.set(a.id, a.name ?? "");
    }
  }

  private rowToMeta(row: NoteRow): NoteMeta {
    const folder = this.folderCache.get(row.folderId ?? 0);
    const accountName = folder
      ? (this.accountCache.get(folder.accountId) ?? "")
      : "";

    return {
      id: row.id,
      title: row.title ?? "",
      snippet: row.snippet ?? "",
      folderId: row.folderId ?? 0,
      folderName: folder?.name ?? "",
      accountId: folder?.accountId ?? 0,
      accountName,
      createdAt: Q.macTimeToDate(row.createdAt ?? null),
      modifiedAt: Q.macTimeToDate(row.modifiedAt ?? null),
      isPasswordProtected: (row.isPasswordProtected ?? 0) === 1,
    };
  }

  listAccounts(): Account[] {
    const rows = this.db
      .query(Q.LIST_ACCOUNTS)
      .all(this.entityTypes.account) as AccountRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? "",
    }));
  }

  listFolders(account?: string): Folder[] {
    const rows = this.db
      .query(Q.LIST_FOLDERS)
      .all(this.entityTypes.folder) as FolderRow[];

    const countRows = this.db
      .query(Q.COUNT_NOTES_PER_FOLDER)
      .all(this.entityTypes.note) as { folderId: number; count: number }[];
    const countMap = new Map(countRows.map((r) => [r.folderId, r.count]));

    let results = rows.map((r) => ({
      id: r.id,
      name: r.name ?? "",
      accountId: r.accountId ?? 0,
      accountName: this.accountCache.get(r.accountId ?? 0) ?? "",
      noteCount: countMap.get(r.id) ?? 0,
    }));

    if (account) {
      results = results.filter(
        (f) =>
          f.accountName.toLowerCase() === account.toLowerCase() ||
          f.accountId === Number(account),
      );
    }

    return results;
  }

  listNotes(
    options?: ListNotesOptions,
  ): { meta: NoteMeta; zdata: Buffer | null }[] {
    const rows = this.db
      .query(Q.listNotes(this.dateColumns))
      .all(this.entityTypes.note) as NoteRow[];

    let results = rows.map((r) => ({
      meta: this.rowToMeta(r),
      zdata: r.zdata as Buffer | null,
    }));

    if (options?.folder) {
      results = results.filter(
        (r) =>
          r.meta.folderName.toLowerCase() === options.folder?.toLowerCase() ||
          r.meta.folderId === Number(options.folder),
      );
    }

    if (options?.account) {
      results = results.filter(
        (r) =>
          r.meta.accountName.toLowerCase() === options.account?.toLowerCase() ||
          r.meta.accountId === Number(options.account),
      );
    }

    return results;
  }

  getNote(noteId: number): { meta: NoteMeta; zdata: Buffer | null } | null {
    const row = this.db
      .query(Q.getNote(this.dateColumns))
      .get(noteId) as NoteRow | null;
    if (!row) return null;
    return {
      meta: this.rowToMeta(row),
      zdata: row.zdata as Buffer | null,
    };
  }

  search(query: string, options?: SearchOptions): NoteMeta[] {
    const pattern = `%${query}%`;
    const limit = options?.limit ?? 50;

    const rows = this.db
      .query(Q.searchBySnippet(this.dateColumns))
      .all(pattern, pattern, this.entityTypes.note, limit) as NoteRow[];

    let results = rows.map((r) => this.rowToMeta(r));

    if (options?.folder) {
      results = results.filter(
        (r) =>
          r.folderName.toLowerCase() === options.folder?.toLowerCase() ||
          r.folderId === Number(options.folder),
      );
    }

    return results;
  }

  resolveMediaIdentifier(
    attachmentIdentifier: string,
  ): { mediaIdentifier: string; mediaFilename: string } | null {
    try {
      const row = this.db
        .query(Q.RESOLVE_MEDIA_IDENTIFIER)
        .get(attachmentIdentifier) as {
        mediaIdentifier: string | null;
        mediaFilename: string | null;
      } | null;
      if (!row?.mediaIdentifier) return null;
      return {
        mediaIdentifier: row.mediaIdentifier,
        mediaFilename: row.mediaFilename ?? "",
      };
    } catch {
      // ZMEDIA column may not exist in older databases or test fixtures
      return null;
    }
  }

  listAttachments(noteId: number): AttachmentRef[] {
    const rows = this.db
      .query(Q.GET_ATTACHMENTS)
      .all(noteId, this.entityTypes.attachment) as AttachmentRow[];

    return rows.map((r) => ({
      id: r.id,
      identifier: r.identifier ?? "",
      name: r.name ?? "",
      contentType: r.contentType ?? "",
      url: null, // Resolved by AttachmentResolver
    }));
  }
}
