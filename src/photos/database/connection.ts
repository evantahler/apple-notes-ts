import { homedir } from "node:os";
import { join } from "node:path";
import { openDatabase as openDatabaseShared } from "../../database/connection.ts";

const DEFAULT_PHOTOS_DB = join(
  homedir(),
  "Pictures/Photos Library.photoslibrary/database/Photos.sqlite",
);

export function openDatabase(dbPath?: string) {
  const path = dbPath ?? DEFAULT_PHOTOS_DB;
  return openDatabaseShared(path, path);
}
