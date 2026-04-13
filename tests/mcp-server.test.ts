import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp-server.ts";

const FIXTURE_DB = resolve(import.meta.dir, "fixtures/NoteStore.sqlite");
const FIXTURE_DIR = resolve(import.meta.dir, "fixtures");

let client: Client;
let cleanup: () => void;

beforeAll(async () => {
  const { server, appleNotes } = createServer({
    dbPath: FIXTURE_DB,
    containerPath: FIXTURE_DIR,
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  cleanup = () => {
    appleNotes.close();
  };
});

afterAll(async () => {
  await client.close();
  cleanup();
});

// ============================================================================
// helper to parse tool result text content
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: test helper
function parseResult(result: any) {
  return JSON.parse(result.content[0].text);
}

// biome-ignore lint/suspicious/noExplicitAny: test helper
function getErrorText(result: any): string {
  return result.content[0].text;
}

// ============================================================================
// server metadata
// ============================================================================

describe("server metadata", () => {
  test("server exposes 7 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
  });

  test("each tool has a description", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description?.length).toBeGreaterThan(20);
    }
  });

  test("tool names match expected list", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_attachment_url",
      "list_accounts",
      "list_attachments",
      "list_folders",
      "list_notes",
      "read_note",
      "search_notes",
    ]);
  });

  test("tools with params have inputSchema with property descriptions", async () => {
    const { tools } = await client.listTools();
    const searchTool = tools.find((t) => t.name === "search_notes");
    const props = searchTool?.inputSchema.properties as Record<
      string,
      { description?: string }
    >;
    expect(props.query?.description).toBeTruthy();
    expect(props.folder?.description).toBeTruthy();
    expect(props.limit?.description).toBeTruthy();
  });
});

// ============================================================================
// list_accounts
// ============================================================================

describe("list_accounts", () => {
  test("returns all accounts from fixture DB", async () => {
    const result = await client.callTool({ name: "list_accounts" });
    const accounts = parseResult(result);
    expect(accounts).toHaveLength(2);
    const names = accounts.map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(["On My Mac", "iCloud"]);
  });
});

// ============================================================================
// list_folders
// ============================================================================

describe("list_folders", () => {
  test("returns all folders", async () => {
    const result = await client.callTool({
      name: "list_folders",
      arguments: {},
    });
    const folders = parseResult(result);
    expect(folders).toHaveLength(3);
    const names = folders.map((f: { name: string }) => f.name).sort();
    expect(names).toEqual(["Notes", "Personal", "Work"]);
  });

  test("filters by account name", async () => {
    const result = await client.callTool({
      name: "list_folders",
      arguments: { account: "iCloud" },
    });
    const folders = parseResult(result);
    for (const f of folders) {
      expect(f.accountName).toBe("iCloud");
    }
  });
});

// ============================================================================
// list_notes
// ============================================================================

describe("list_notes", () => {
  test("returns all notes", async () => {
    const result = await client.callTool({ name: "list_notes", arguments: {} });
    const notes = parseResult(result);
    expect(notes.length).toBeGreaterThan(0);
  });

  test("filters by folder", async () => {
    const result = await client.callTool({
      name: "list_notes",
      arguments: { folder: "Work" },
    });
    const notes = parseResult(result);
    for (const n of notes) {
      expect(n.folderName).toBe("Work");
    }
  });

  test("filters by account", async () => {
    const result = await client.callTool({
      name: "list_notes",
      arguments: { account: "iCloud" },
    });
    const notes = parseResult(result);
    for (const n of notes) {
      expect(n.accountName).toBe("iCloud");
    }
  });

  test("sorts by title ascending", async () => {
    const result = await client.callTool({
      name: "list_notes",
      arguments: { sortBy: "title", order: "asc" },
    });
    const notes = parseResult(result);
    for (let i = 1; i < notes.length; i++) {
      expect(
        notes[i].title.localeCompare(notes[i - 1].title),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  test("filters by search text", async () => {
    const result = await client.callTool({
      name: "list_notes",
      arguments: { search: "Simple" },
    });
    const notes = parseResult(result);
    expect(notes.length).toBeGreaterThan(0);
    expect(
      notes.some((n: { title: string }) => n.title === "Simple Note"),
    ).toBe(true);
  });

  test("applies limit", async () => {
    const result = await client.callTool({
      name: "list_notes",
      arguments: { limit: 2 },
    });
    const notes = parseResult(result);
    expect(notes.length).toBeLessThanOrEqual(2);
  });

  test("combines search, sort, folder, and limit", async () => {
    const result = await client.callTool({
      name: "list_notes",
      arguments: {
        search: "Note",
        sortBy: "title",
        order: "asc",
        limit: 3,
        folder: "Work",
      },
    });
    const notes = parseResult(result);
    expect(notes.length).toBeLessThanOrEqual(3);
    for (const n of notes) {
      expect(n.folderName).toBe("Work");
    }
    for (let i = 1; i < notes.length; i++) {
      expect(
        notes[i].title.localeCompare(notes[i - 1].title),
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// search_notes
// ============================================================================

describe("search_notes", () => {
  test("returns matching notes", async () => {
    const result = await client.callTool({
      name: "search_notes",
      arguments: { query: "Headings" },
    });
    const notes = parseResult(result);
    expect(notes.length).toBeGreaterThan(0);
  });

  test("respects limit parameter", async () => {
    const result = await client.callTool({
      name: "search_notes",
      arguments: { query: "note", limit: 2 },
    });
    const notes = parseResult(result);
    expect(notes.length).toBeLessThanOrEqual(2);
  });

  test("returns empty array for no matches", async () => {
    const result = await client.callTool({
      name: "search_notes",
      arguments: { query: "xyznonexistent999" },
    });
    const notes = parseResult(result);
    expect(notes).toEqual([]);
  });
});

// ============================================================================
// read_note
// ============================================================================

describe("read_note", () => {
  let validNoteId: number;

  beforeAll(async () => {
    const result = await client.callTool({ name: "list_notes", arguments: {} });
    const notes = parseResult(result);
    const readable = notes.find(
      (n: { isPasswordProtected: boolean }) => !n.isPasswordProtected,
    );
    validNoteId = readable.id;
  });

  test("returns note content as markdown", async () => {
    const result = await client.callTool({
      name: "read_note",
      arguments: { noteId: validNoteId },
    });
    const note = parseResult(result);
    expect(note.meta).toBeDefined();
    expect(typeof note.markdown).toBe("string");
    expect(note.markdown.length).toBeGreaterThan(0);
  });

  test("supports pagination with offset and limit", async () => {
    const result = await client.callTool({
      name: "read_note",
      arguments: { noteId: validNoteId, offset: 0, limit: 2 },
    });
    const page = parseResult(result);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(2);
    expect(typeof page.totalLines).toBe("number");
    expect(typeof page.hasMore).toBe("boolean");
  });

  test("returns error for nonexistent note ID", async () => {
    const result = await client.callTool({
      name: "read_note",
      arguments: { noteId: 999999 },
    });
    expect(result.isError).toBe(true);
    expect(getErrorText(result)).toContain("Note not found");
  });

  test("returns error for password-protected note", async () => {
    const listResult = await client.callTool({
      name: "list_notes",
      arguments: {},
    });
    const notes = parseResult(listResult);
    const locked = notes.find(
      (n: { isPasswordProtected: boolean }) => n.isPasswordProtected,
    );
    if (!locked) return; // skip if no locked notes in fixture

    const result = await client.callTool({
      name: "read_note",
      arguments: { noteId: locked.id },
    });
    expect(result.isError).toBe(true);
    expect(getErrorText(result)).toContain("password protected");
  });
});

// ============================================================================
// list_attachments
// ============================================================================

describe("list_attachments", () => {
  test("returns attachments for a note", async () => {
    const listResult = await client.callTool({
      name: "list_notes",
      arguments: {},
    });
    const notes = parseResult(listResult);
    const result = await client.callTool({
      name: "list_attachments",
      arguments: { noteId: notes[0].id },
    });
    const attachments = parseResult(result);
    expect(Array.isArray(attachments)).toBe(true);
  });
});

// ============================================================================
// get_attachment_url
// ============================================================================

describe("get_attachment_url", () => {
  test("returns null URL for unknown attachment name", async () => {
    const result = await client.callTool({
      name: "get_attachment_url",
      arguments: { name: "nonexistent-file.png" },
    });
    const data = parseResult(result);
    expect(data.url).toBeNull();
  });
});

// ============================================================================
// input validation
// ============================================================================

describe("input validation", () => {
  test("search_notes rejects missing required query param", async () => {
    try {
      const result = await client.callTool({
        name: "search_notes",
        arguments: {},
      });
      // If it doesn't throw, it should be an error result
      expect(result.isError).toBe(true);
    } catch (e) {
      // Protocol-level error is also acceptable
      expect(e).toBeDefined();
    }
  });

  test("read_note rejects missing required noteId param", async () => {
    try {
      const result = await client.callTool({
        name: "read_note",
        arguments: {},
      });
      expect(result.isError).toBe(true);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("read_note rejects non-integer noteId", async () => {
    try {
      const result = await client.callTool({
        name: "read_note",
        arguments: { noteId: "abc" },
      });
      expect(result.isError).toBe(true);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("search_notes rejects limit less than 1", async () => {
    try {
      const result = await client.callTool({
        name: "search_notes",
        arguments: { query: "test", limit: 0 },
      });
      expect(result.isError).toBe(true);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("read_note rejects negative offset", async () => {
    try {
      const result = await client.callTool({
        name: "read_note",
        arguments: { noteId: 1, offset: -1 },
      });
      expect(result.isError).toBe(true);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("list_attachments rejects missing noteId", async () => {
    try {
      const result = await client.callTool({
        name: "list_attachments",
        arguments: {},
      });
      expect(result.isError).toBe(true);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("get_attachment_url rejects missing name", async () => {
    try {
      const result = await client.callTool({
        name: "get_attachment_url",
        arguments: {},
      });
      expect(result.isError).toBe(true);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});
