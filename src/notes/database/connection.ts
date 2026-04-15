import { homedir } from "node:os";
import { join } from "node:path";
import { openDatabase as openDatabaseShared } from "../../database/connection.ts";

const DEFAULT_DB_PATH = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite",
);

export function openDatabase(dbPath?: string) {
  return openDatabaseShared(dbPath, DEFAULT_DB_PATH);
}

export function defaultDatabasePath(): string {
  return DEFAULT_DB_PATH;
}
