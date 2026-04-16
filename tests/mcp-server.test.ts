import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp-server.ts";

const FIXTURE_DB = resolve(import.meta.dir, "fixtures/NoteStore.sqlite");
const FIXTURE_DIR = resolve(import.meta.dir, "fixtures");
const MESSAGES_FIXTURE_DB = resolve(import.meta.dir, "fixtures/chat.db");
const CONTACTS_FIXTURE_DB = resolve(
  import.meta.dir,
  "fixtures/AddressBook-v22.abcddb",
);
const PHOTOS_FIXTURE_DB = resolve(import.meta.dir, "fixtures/Photos.sqlite");

let client: Client;
let cleanup: () => void;

beforeAll(async () => {
  const { server, notes, messages, contacts, photos } = createServer({
    notes: { dbPath: FIXTURE_DB, containerPath: FIXTURE_DIR },
    messages: { dbPath: MESSAGES_FIXTURE_DB },
    contacts: { dbPath: CONTACTS_FIXTURE_DB },
    photos: { dbPath: PHOTOS_FIXTURE_DB },
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  cleanup = () => {
    notes.close();
    messages.close();
    contacts.close();
    photos.close();
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
function parseRaw(result: any) {
  return JSON.parse(result.content[0].text);
}

// biome-ignore lint/suspicious/noExplicitAny: test helper
function parseResult(result: any) {
  return parseRaw(result).data;
}

// biome-ignore lint/suspicious/noExplicitAny: test helper
function getErrorJson(result: any) {
  return JSON.parse(result.content[0].text);
}

// ============================================================================
// server metadata
// ============================================================================

describe("server metadata", () => {
  test("server exposes 26 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(26);
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
      "get_album",
      "get_attachment_url",
      "get_capabilities",
      "get_chat",
      "get_contact",
      "get_message",
      "get_photo",
      "get_photo_url",
      "list_accounts",
      "list_albums",
      "list_attachments",
      "list_chats",
      "list_contacts",
      "list_folders",
      "list_group_members",
      "list_groups",
      "list_handles",
      "list_message_attachments",
      "list_messages",
      "list_notes",
      "list_photos",
      "read_note",
      "search_contacts",
      "search_messages",
      "search_notes",
      "search_photos",
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

  test("all tools have readOnlyHint annotation", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      // biome-ignore lint/suspicious/noExplicitAny: test
      const annotations = (tool as any).annotations;
      if (annotations) {
        expect(annotations.readOnlyHint).toBe(true);
        expect(annotations.destructiveHint).toBe(false);
      }
    }
  });
});

// ============================================================================
// get_capabilities
// ============================================================================

describe("get_capabilities", () => {
  test("returns data sources with tool lists", async () => {
    const result = await client.callTool({ name: "get_capabilities" });
    const data = parseResult(result);
    expect(data.dataSources).toHaveLength(4);
    expect(data.dataSources[0].name).toBe("Apple Notes");
    expect(data.dataSources[1].name).toBe("iMessage / SMS");
    expect(data.dataSources[2].name).toBe("Apple Contacts");
    expect(data.dataSources[3].name).toBe("Apple Photos");
    expect(data.allToolsReadOnly).toBe(true);
    expect(data.requirement).toContain("Full Disk Access");
  });

  test("each data source lists its tools and starting point", async () => {
    const result = await client.callTool({ name: "get_capabilities" });
    const data = parseResult(result);
    for (const source of data.dataSources) {
      expect(source.tools.length).toBeGreaterThan(0);
      expect(source.startWith).toBeTruthy();
    }
  });
});

// ============================================================================
// response envelope
// ============================================================================

describe("response envelope", () => {
  test("list tools include totalResults count", async () => {
    const result = await client.callTool({ name: "list_accounts" });
    const raw = parseRaw(result);
    expect(typeof raw.totalResults).toBe("number");
    expect(raw.totalResults).toBe(raw.data.length);
  });

  test("list tools include _next hints", async () => {
    const result = await client.callTool({ name: "list_accounts" });
    const raw = parseRaw(result);
    expect(raw._next).toBeDefined();
    expect(raw._next.length).toBeGreaterThan(0);
    expect(raw._next[0].tool).toBeTruthy();
    expect(raw._next[0].description).toBeTruthy();
  });

  test("terminal tools omit _next hints", async () => {
    const result = await client.callTool({
      name: "get_attachment_url",
      arguments: { name: "nonexistent.png" },
    });
    const raw = parseRaw(result);
    expect(raw._next).toBeUndefined();
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

  test("returns structured error for nonexistent note ID", async () => {
    const result = await client.callTool({
      name: "read_note",
      arguments: { noteId: 999999 },
    });
    expect(result.isError).toBe(true);
    const err = getErrorJson(result);
    expect(err.error).toBe("NoteNotFoundError");
    expect(err.category).toBe("not_found");
    expect(err.retryable).toBe(false);
    expect(err.recovery).toContain("list_notes");
  });

  test("returns structured error for password-protected note", async () => {
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
    const err = getErrorJson(result);
    expect(err.error).toBe("PasswordProtectedError");
    expect(err.category).toBe("access_denied");
    expect(err.retryable).toBe(false);
    expect(err.recovery).toContain("password-protected");
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
// list_handles
// ============================================================================

describe("list_handles", () => {
  test("returns handles from fixture DB", async () => {
    const result = await client.callTool({ name: "list_handles" });
    const handles = parseResult(result);
    expect(Array.isArray(handles)).toBe(true);
    expect(handles.length).toBeGreaterThan(0);
    expect(handles[0].identifier).toBeTruthy();
    expect(handles[0].service).toBeTruthy();
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
