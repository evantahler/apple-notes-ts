import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONTAINER_PATH = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes",
);

export class AttachmentResolver {
  private containerPath: string;

  constructor(containerPath?: string) {
    this.containerPath = containerPath ?? DEFAULT_CONTAINER_PATH;
  }

  resolve(identifier: string): string | null {
    // Search in priority order: FallbackPDFs first (for scanned/Paper docs),
    // then Media (most common), then the full Accounts tree as fallback.
    const accountsPath = join(this.containerPath, "Accounts");
    if (existsSync(accountsPath)) {
      try {
        const accounts = readdirSync(accountsPath, { withFileTypes: true });
        for (const acct of accounts) {
          if (!acct.isDirectory()) continue;
          const acctPath = join(accountsPath, acct.name);
          // Prioritized subdirectories within each account
          for (const sub of ["FallbackPDFs", "Media"]) {
            const subPath = join(acctPath, sub);
            if (!existsSync(subPath)) continue;
            const found = this.findFile(subPath, identifier);
            if (found) return `file://${found}`;
          }
        }
      } catch {
        // Permission denied
      }
    }

    // Fallback: search top-level FallbackPDFs, Media, and full Accounts tree
    for (const sub of ["FallbackPDFs", "Media", "Accounts"]) {
      const basePath = join(this.containerPath, sub);
      if (!existsSync(basePath)) continue;
      const found = this.findFile(basePath, identifier);
      if (found) return `file://${found}`;
    }

    return null;
  }

  private findFirstFile(dir: string, depth = 0): string | null {
    if (depth > 2) return null;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      // Prefer files at current level
      const file = entries.find((e) => e.isFile());
      if (file) return join(dir, file.name);
      // Otherwise recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const found = this.findFirstFile(join(dir, entry.name), depth + 1);
          if (found) return found;
        }
      }
    } catch {
      // Permission denied or other FS error
    }
    return null;
  }

  private findFile(dir: string, identifier: string, depth = 0): string | null {
    const MAX_DEPTH = 4;
    if (depth > MAX_DEPTH) return null;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip macOS bundles — they contain internal databases, not user files
          if (entry.name.endsWith(".bundle")) continue;

          if (entry.name === identifier) {
            // Found the UUID directory — find the first file in it (may be nested)
            const file = this.findFirstFile(fullPath);
            if (file) return file;
          }
          // Recurse deeper (e.g. Accounts/<acct>/Media/<uuid>/file)
          const found = this.findFile(fullPath, identifier, depth + 1);
          if (found) return found;
        }
      }
    } catch {
      // Permission denied or other FS error
    }
    return null;
  }
}
