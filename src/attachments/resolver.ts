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
    // Attachments are stored in various locations. Try known patterns.
    const searchPaths = [
      join(this.containerPath, "Accounts"),
      join(this.containerPath, "Media"),
    ];

    for (const basePath of searchPaths) {
      if (!existsSync(basePath)) continue;
      const found = this.findFile(basePath, identifier);
      if (found) return `file://${found}`;
    }

    return null;
  }

  private findFile(dir: string, identifier: string): string | null {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === identifier || entry.name.includes(identifier)) {
            // Found the UUID directory - return the first file in it
            const files = readdirSync(fullPath, { withFileTypes: true });
            const file = files.find((f) => f.isFile());
            if (file) return join(fullPath, file.name);
          }
          // Recurse one level only to avoid excessive scanning
          const subEntries = readdirSync(fullPath, { withFileTypes: true });
          for (const sub of subEntries) {
            if (
              sub.isDirectory() &&
              (sub.name === identifier || sub.name.includes(identifier))
            ) {
              const subPath = join(fullPath, sub.name);
              const files = readdirSync(subPath, { withFileTypes: true });
              const file = files.find((f) => f.isFile());
              if (file) return join(subPath, file.name);
            }
          }
        }
      }
    } catch {
      // Permission denied or other FS error
    }
    return null;
  }
}
