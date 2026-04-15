import { unlinkSync } from "node:fs";
import { dirname } from "node:path";

export { dateToMacNanos, dateToMacTime } from "../../src/database/timestamps.ts";

export const FIXTURE_DIR = dirname(new URL(import.meta.url).pathname);

/**
 * Remove an existing SQLite database and its WAL/SHM files.
 */
export function cleanupDatabase(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${dbPath}${suffix}`);
    } catch {}
  }
}
