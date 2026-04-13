import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { NoteNotFoundError, PasswordProtectedError } from "../src/errors.ts";
import { AppleNotes } from "../src/index.ts";

const FIXTURE_DB = resolve(import.meta.dir, "fixtures/NoteStore.sqlite");
const FIXTURE_DIR = resolve(import.meta.dir, "fixtures");

let db: AppleNotes;

beforeAll(() => {
  db = new AppleNotes({ dbPath: FIXTURE_DB, containerPath: FIXTURE_DIR });
});

afterAll(() => {
  db.close();
});

// ============================================================================
// accounts()
// ============================================================================

describe("accounts", () => {
  test("returns all accounts", () => {
    const accounts = db.accounts();
    expect(accounts).toHaveLength(2);

    const names = accounts.map((a) => a.name).sort();
    expect(names).toEqual(["On My Mac", "iCloud"]);
  });

  test("accounts have numeric ids", () => {
    const accounts = db.accounts();
    for (const a of accounts) {
      expect(typeof a.id).toBe("number");
    }
  });
});

// ============================================================================
// folders()
// ============================================================================

describe("folders", () => {
  test("returns all folders", () => {
    const folders = db.folders();
    expect(folders).toHaveLength(3);

    const names = folders.map((f) => f.name).sort();
    expect(names).toEqual(["Notes", "Personal", "Work"]);
  });

  test("folders have account info", () => {
    const folders = db.folders();
    const workFolder = folders.find((f) => f.name === "Work");
    expect(workFolder).toBeDefined();
    expect(workFolder?.accountName).toBe("iCloud");
  });

  test("filters by account name", () => {
    const folders = db.folders("On My Mac");
    expect(folders).toHaveLength(1);
    expect(folders[0]?.name).toBe("Personal");
  });
});

// ============================================================================
// notes()
// ============================================================================

describe("notes", () => {
  test("returns all notes", () => {
    const notes = db.notes();
    expect(notes).toHaveLength(14);
  });

  test("filters by folder name", () => {
    const workNotes = db.notes({ folder: "Work" });
    expect(workNotes.length).toBeGreaterThan(0);
    for (const n of workNotes) {
      expect(n.folderName).toBe("Work");
    }
  });

  test("notes have expected metadata fields", () => {
    const notes = db.notes();
    const simple = notes.find((n) => n.title === "Simple Note");
    expect(simple).toBeDefined();
    expect(simple?.snippet).toBeTruthy();
    expect(simple?.createdAt).toBeInstanceOf(Date);
    expect(simple?.modifiedAt).toBeInstanceOf(Date);
    expect(simple?.isPasswordProtected).toBe(false);
  });

  test("password protected note has flag set", () => {
    const notes = db.notes();
    const secret = notes.find((n) => n.title === "Secret Note");
    expect(secret).toBeDefined();
    expect(secret?.isPasswordProtected).toBe(true);
  });

  test("sorts by title ascending", () => {
    const titles = db
      .notes({ sortBy: "title", order: "asc" })
      .map((n) => n.title);
    expect(titles.length).toBeGreaterThan(1);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });

  test("sorts by title descending", () => {
    const titles = db
      .notes({ sortBy: "title", order: "desc" })
      .map((n) => n.title);
    expect(titles.length).toBeGreaterThan(1);
    const sorted = [...titles].sort((a, b) => b.localeCompare(a));
    expect(titles).toEqual(sorted);
  });

  test("sorts by createdAt ascending", () => {
    const times = db
      .notes({ sortBy: "createdAt", order: "asc" })
      .map((n) => n.createdAt.getTime());
    expect(times.length).toBeGreaterThan(1);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  test("defaults to modifiedAt descending", () => {
    const times = db.notes().map((n) => n.modifiedAt.getTime());
    expect(times.length).toBeGreaterThan(1);
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  test("search filters by title", () => {
    const notes = db.notes({ search: "Simple" });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => n.title === "Simple Note")).toBe(true);
  });

  test("search is case-insensitive", () => {
    const notes = db.notes({ search: "simple" });
    expect(notes.some((n) => n.title === "Simple Note")).toBe(true);
  });

  test("search returns empty for non-matching query", () => {
    const notes = db.notes({ search: "xyznonexistent123" });
    expect(notes).toHaveLength(0);
  });

  test("search combined with folder filter", () => {
    const notes = db.notes({ search: "Note", folder: "Work" });
    for (const n of notes) {
      expect(n.folderName).toBe("Work");
    }
  });

  test("search combined with sort", () => {
    const titles = db
      .notes({ search: "Note", sortBy: "title", order: "asc" })
      .map((n) => n.title);
    expect(titles.length).toBeGreaterThan(1);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });

  test("limit restricts result count", () => {
    const all = db.notes();
    const limited = db.notes({ limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited.length).toBeLessThan(all.length);
  });

  test("limit with sort returns correct subset", () => {
    const allSorted = db.notes({ sortBy: "title", order: "asc" });
    const limited = db.notes({ sortBy: "title", order: "asc", limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.title).toBe(allSorted[0]?.title);
    expect(limited[1]?.title).toBe(allSorted[1]?.title);
  });
});

// ============================================================================
// search()
// ============================================================================

describe("search", () => {
  test("finds notes by title", () => {
    const results = db.search("Simple");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title === "Simple Note")).toBe(true);
  });

  test("finds notes by snippet", () => {
    const results = db.search("plain text");
    expect(results.length).toBeGreaterThan(0);
  });

  test("returns empty for non-matching query", () => {
    const results = db.search("xyznonexistent123");
    expect(results).toHaveLength(0);
  });

  test("respects folder filter", () => {
    const results = db.search("Note", { folder: "Work" });
    for (const r of results) {
      expect(r.folderName).toBe("Work");
    }
  });

  test("respects limit", () => {
    const results = db.search("Note", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// read()
// ============================================================================

describe("read", () => {
  test("reads a simple plain text note", () => {
    const content = db.read(100);
    expect(content.meta.title).toBe("Simple Note");
    expect(content.markdown).toContain("# Simple Note");
    expect(content.markdown).toContain("simple plain text note");
  });

  test("reads a note with bold and italic formatting", () => {
    const content = db.read(101);
    expect(content.markdown).toContain("**bold**");
    expect(content.markdown).toContain("*italic*");
    expect(content.markdown).toContain("***bold italic***");
  });

  test("reads a note with strikethrough and underline", () => {
    const content = db.read(101);
    expect(content.markdown).toContain("~~strikethrough~~");
    expect(content.markdown).toContain("<u>underline</u>");
  });

  test("reads headings correctly", () => {
    const content = db.read(102);
    expect(content.markdown).toContain("# Headings Test");
    expect(content.markdown).toContain("## Main Section");
    expect(content.markdown).toContain("### Sub Section");
    expect(content.markdown).toContain("Body text here.");
  });

  test("reads bullet and numbered lists", () => {
    const content = db.read(103);
    expect(content.markdown).toContain("- First bullet");
    expect(content.markdown).toContain("- Second bullet");
    expect(content.markdown).toContain("  - Nested bullet");
    expect(content.markdown).toContain("1. First numbered");
    expect(content.markdown).toContain("1. Second numbered");
  });

  test("reads checklists", () => {
    const content = db.read(104);
    expect(content.markdown).toContain("- [x] Buy groceries");
    expect(content.markdown).toContain("- [ ] Clean house");
    expect(content.markdown).toContain("- [x] Write code");
    expect(content.markdown).toContain("- [ ] Review PR");
  });

  test("reads code blocks", () => {
    const content = db.read(105);
    expect(content.markdown).toContain("```");
    expect(content.markdown).toContain("function hello() {");
    expect(content.markdown).toContain("  return 'world';");
  });

  test("reads links", () => {
    const content = db.read(106);
    expect(content.markdown).toContain("[Example](https://example.com)");
    expect(content.markdown).toContain("[Other Site](https://other-site.com)");
  });

  test("reads block quotes", () => {
    const content = db.read(107);
    expect(content.markdown).toContain("> To be or not to be.");
  });

  test("reads inline code", () => {
    const content = db.read(111);
    expect(content.markdown).toContain("`console.log`");
  });

  test("reads attachment placeholders", () => {
    const content = db.read(110);
    expect(content.markdown).toContain(
      "![attachment](attachment:ATTACH-UUID-001",
    );
  });

  test("throws NoteNotFoundError for missing note", () => {
    expect(() => db.read(99999)).toThrow(NoteNotFoundError);
  });

  test("throws PasswordProtectedError for locked note", () => {
    expect(() => db.read(109)).toThrow(PasswordProtectedError);
  });
});

// ============================================================================
// read() with pagination
// ============================================================================

describe("read with pagination", () => {
  test("paginates large note", () => {
    const page1 = db.read(108, { offset: 0, limit: 10 });
    expect(page1.markdown.split("\n")).toHaveLength(10);
    expect(page1.offset).toBe(0);
    expect(page1.limit).toBe(10);
    expect(page1.totalLines).toBeGreaterThan(100);
    expect(page1.hasMore).toBe(true);
  });

  test("second page starts where first ends", () => {
    const page1 = db.read(108, { offset: 0, limit: 10 });
    const page2 = db.read(108, { offset: 10, limit: 10 });

    expect(page2.offset).toBe(10);
    expect(page2.hasMore).toBe(true);

    // Pages should have different content
    expect(page2.markdown).not.toBe(page1.markdown);
  });

  test("last page has hasMore=false", () => {
    const full = db.read(108);
    const totalLines = full.markdown.split("\n").length;
    const lastPage = db.read(108, {
      offset: totalLines - 5,
      limit: 10,
    });

    expect(lastPage.hasMore).toBe(false);
  });

  test("returns correct totalLines", () => {
    const full = db.read(108);
    const totalLines = full.markdown.split("\n").length;
    const page = db.read(108, { offset: 0, limit: 5 });

    expect(page.totalLines).toBe(totalLines);
  });

  test("pagination of a small note", () => {
    const page = db.read(100, { offset: 0, limit: 100 });
    expect(page.hasMore).toBe(false);
    expect(page.totalLines).toBeLessThan(100);
  });
});

// ============================================================================
// read() with embedded table
// ============================================================================

describe("read with embedded table", () => {
  test("renders table as markdown instead of attachment placeholder", () => {
    const content = db.read(113);
    expect(content.meta.title).toBe("Note With Table");
    expect(content.markdown).toContain("# Note With Table");
    expect(content.markdown).toContain("Here is a table:");
    // Should NOT contain the attachment placeholder
    expect(content.markdown).not.toContain("com.apple.notes.table");
    // Should contain markdown table
    expect(content.markdown).toContain("| Name | Value |");
    expect(content.markdown).toContain("| --- | --- |");
    expect(content.markdown).toContain("| Alpha | 100 |");
    expect(content.markdown).toContain("| Beta | 200 |");
  });
});

// ============================================================================
// listAttachments()
// ============================================================================

describe("listAttachments", () => {
  test("returns attachments for a note with attachments", () => {
    // Note 110 has an attachment
    const attachments = db.listAttachments(110);
    expect(attachments.length).toBeGreaterThan(0);
    expect(attachments[0]?.contentType).toBe("public.jpeg");
  });

  test("resolves attachment URLs via ZMEDIA relationship", () => {
    const attachments = db.listAttachments(110);
    expect(attachments.length).toBeGreaterThan(0);
    // URL should resolve through ZMEDIA to the media row's identifier
    expect(attachments[0]?.url).not.toBeNull();
    expect(attachments[0]?.url).toStartWith("file://");
    expect(attachments[0]?.url).toContain("MEDIA-UUID-001");
    expect(attachments[0]?.url).toContain("photo.jpg");
  });

  test("returns empty array for note without attachments", () => {
    const attachments = db.listAttachments(100);
    expect(attachments).toHaveLength(0);
  });
});

// ============================================================================
// getAttachmentUrl()
// ============================================================================

describe("getAttachmentUrl", () => {
  test("resolves attachment identifier via ZMEDIA to file on disk", () => {
    // ATTACH-UUID-001 has ZMEDIA -> MEDIA-UUID-001, and the file lives
    // under the media identifier directory, not the attachment identifier
    const url = db.getAttachmentUrl("ATTACH-UUID-001");
    expect(url).not.toBeNull();
    expect(url).toStartWith("file://");
    expect(url).toContain("MEDIA-UUID-001");
    expect(url).toContain("photo.jpg");
  });

  test("resolves media identifier directly", () => {
    // The media identifier itself should also resolve directly
    const url = db.getAttachmentUrl("MEDIA-UUID-001");
    expect(url).not.toBeNull();
    expect(url).toStartWith("file://");
    expect(url).toContain("photo.jpg");
  });

  test("resolves Paper/PDF attachment via FallbackPDFs directory", () => {
    // PDF-ATTACH-UUID-001 has no ZMEDIA — the file is in FallbackPDFs/
    const url = db.getAttachmentUrl("PDF-ATTACH-UUID-001");
    expect(url).not.toBeNull();
    expect(url).toStartWith("file://");
    expect(url).toContain("FallbackPDFs");
    expect(url).toContain("FallbackPDF.pdf");
  });

  test("returns null for unknown attachment", () => {
    const url = db.getAttachmentUrl("NONEXISTENT-UUID");
    expect(url).toBeNull();
  });
});

// ============================================================================
// close()
// ============================================================================

describe("close", () => {
  test("does not throw", () => {
    const tempDb = new AppleNotes({
      dbPath: FIXTURE_DB,
      containerPath: FIXTURE_DIR,
    });
    expect(() => tempDb.close()).not.toThrow();
  });
});
