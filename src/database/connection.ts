import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { DatabaseAccessDeniedError, DatabaseNotFoundError } from "../errors.ts";

export function openDatabase(
  dbPath: string | undefined,
  defaultPath: string,
): Database {
  const path = dbPath ?? defaultPath;

  if (!existsSync(path)) {
    throw new DatabaseNotFoundError(path);
  }

  try {
    return new Database(path, { readonly: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "SQLITE_AUTH"
    ) {
      throw new DatabaseAccessDeniedError(path);
    }
    throw new DatabaseNotFoundError(path);
  }
}
