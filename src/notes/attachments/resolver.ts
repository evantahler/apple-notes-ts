import { type Dirent, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONTAINER_PATH = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes",
);

const MAX_DEPTH = 4;

export type ResolveResult =
  | { path: string }
  | { error: "not-found" | "permission-denied" };

export class AttachmentResolver {
  private containerPath: string;
  // Lazy index: identifier (UUID-like dir name) -> first file path inside it.
  // Built on first lookup; subsequent lookups are O(1). The container is
  // effectively read-only from this process's POV, so no invalidation.
  private index: Map<string, string> | null = null;
  private hadPermissionError = false;

  constructor(containerPath?: string) {
    this.containerPath = containerPath ?? DEFAULT_CONTAINER_PATH;
  }

  // Back-compat: returns the file URL or null. Callers that need to
  // distinguish "not found" from "permission denied" should use resolveDetailed.
  resolve(identifier: string): string | null {
    const result = this.resolveDetailed(identifier);
    return "path" in result ? `file://${result.path}` : null;
  }

  resolveDetailed(identifier: string): ResolveResult {
    const index = this.getIndex();
    const path = index.get(identifier);
    if (path) return { path };
    return {
      error: this.hadPermissionError ? "permission-denied" : "not-found",
    };
  }

  private getIndex(): Map<string, string> {
    if (this.index) return this.index;
    const index = new Map<string, string>();
    this.index = index;

    // Priority order: per-account FallbackPDFs > per-account Media >
    // top-level FallbackPDFs > top-level Media > top-level Accounts. The
    // first identifier seen wins (the index check inside walkAndIndex
    // prevents later subtrees from overwriting earlier matches).
    const accountsPath = join(this.containerPath, "Accounts");
    if (existsSync(accountsPath)) {
      let accounts: Dirent[] = [];
      try {
        accounts = readdirSync(accountsPath, { withFileTypes: true });
      } catch (err) {
        if (isPermissionError(err)) this.hadPermissionError = true;
      }
      for (const sub of ["FallbackPDFs", "Media"]) {
        for (const acct of accounts) {
          if (!acct.isDirectory()) continue;
          const subPath = join(accountsPath, acct.name, sub);
          if (existsSync(subPath)) this.walkAndIndex(subPath, 0, index);
        }
      }
      // Rendered drawings/images live directly in FallbackImages as
      // "<attachmentUUID>.jpg" (the UUID is the FILENAME, not a subdir), so
      // they need basename-keyed indexing rather than the dir-name walk above.
      for (const acct of accounts) {
        if (!acct.isDirectory()) continue;
        const fiPath = join(accountsPath, acct.name, "FallbackImages");
        if (existsSync(fiPath)) this.indexImagesByBasename(fiPath, index);
      }
    }
    for (const sub of ["FallbackPDFs", "Media", "Accounts"]) {
      const basePath = join(this.containerPath, sub);
      if (existsSync(basePath)) this.walkAndIndex(basePath, 0, index);
    }
    const topFallbackImages = join(this.containerPath, "FallbackImages");
    if (existsSync(topFallbackImages)) {
      this.indexImagesByBasename(topFallbackImages, index);
    }

    return index;
  }

  // Index the entries of a FallbackImages directory by the attachment's
  // ZIDENTIFIER. Two on-disk layouts exist across macOS versions and both key
  // to the same identifier:
  //   flat   — FallbackImages/<id>.jpg            (id is the FILENAME)
  //   nested — FallbackImages/<id>/<sub>/FallbackImage.png  (id is the DIRNAME)
  // For a file we key by basename-without-extension; for a directory we key by
  // the directory name (the id) and resolve to the first file found inside
  // (findFirstFile recurses), rather than recursing and mis-keying on the inner
  // subdir name. First key seen wins, preserving getIndex() priority.
  private indexImagesByBasename(dir: string, index: Map<string, string>): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (isPermissionError(err)) this.hadPermissionError = true;
      return;
    }
    for (const entry of entries) {
      if (entry.name.endsWith(".bundle")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isFile()) {
        const base = entry.name.replace(/\.[^.]+$/, "");
        if (base && !index.has(base)) index.set(base, fullPath);
      } else if (entry.isDirectory()) {
        if (!index.has(entry.name)) {
          const file = this.findFirstFile(fullPath, 0);
          if (file) index.set(entry.name, file);
        }
      }
    }
  }

  private walkAndIndex(
    dir: string,
    depth: number,
    index: Map<string, string>,
  ): void {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (isPermissionError(err)) this.hadPermissionError = true;
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip macOS bundles — they contain internal databases, not user files
      if (entry.name.endsWith(".bundle")) continue;
      const fullPath = join(dir, entry.name);
      if (!index.has(entry.name)) {
        const file = this.findFirstFile(fullPath, 0);
        if (file) index.set(entry.name, file);
      }
      this.walkAndIndex(fullPath, depth + 1, index);
    }
  }

  private findFirstFile(dir: string, depth: number): string | null {
    if (depth > 2) return null;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (isPermissionError(err)) this.hadPermissionError = true;
      return null;
    }
    const file = entries.find((e) => e.isFile());
    if (file) return join(dir, file.name);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = this.findFirstFile(join(dir, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
}

function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM";
}
