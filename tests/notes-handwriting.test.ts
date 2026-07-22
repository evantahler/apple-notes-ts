import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDrawingAttachment, Notes } from "../src/index.ts";
import { AttachmentResolver } from "../src/notes/attachments/resolver.ts";
import { collectDrawingRuns } from "../src/notes/handwriting/drawings.ts";
import { loadImageBase64 } from "../src/notes/handwriting/image.ts";
import type { DecodedNote } from "../src/notes/protobuf/decode.ts";

const FIXTURE_DB = resolve(import.meta.dir, "fixtures/NoteStore.sqlite");
const FIXTURE_DIR = resolve(import.meta.dir, "fixtures");

let db: Notes;
let handwrittenNoteId: number;

beforeAll(() => {
  db = new Notes({ dbPath: FIXTURE_DB, containerPath: FIXTURE_DIR });
  const note = db.notes().find((n) => n.title === "Handwritten Note");
  if (!note) throw new Error("fixture missing 'Handwritten Note'");
  handwrittenNoteId = note.id;
});

afterAll(() => {
  db.close();
});

function noteIdByTitle(title: string): number {
  const note = db.notes().find((n) => n.title === title);
  if (!note) throw new Error(`fixture missing note '${title}'`);
  return note.id;
}

// ============================================================================
// AttachmentResolver FallbackImages layouts
// ============================================================================

describe("AttachmentResolver FallbackImages", () => {
  test("indexes flat <id>.jpg layout by basename", () => {
    const root = mkdtempSync(join(tmpdir(), "notes-resolver-"));
    const fiDir = join(root, "Accounts", "acct", "FallbackImages");
    mkdirSync(fiDir, { recursive: true });
    const id = "FLAT-DRAWING-UUID";
    writeFileSync(join(fiDir, `${id}.jpg`), "fake");
    const resolver = new AttachmentResolver(root);
    const result = resolver.resolveDetailed(id);
    expect("path" in result).toBe(true);
    if ("path" in result) {
      expect(result.path).toContain(`${id}.jpg`);
    }
  });
});

// ============================================================================
// isDrawingAttachment (pure)
// ============================================================================

describe("isDrawingAttachment", () => {
  test("matches known PencilKit drawing UTIs", () => {
    expect(isDrawingAttachment("com.apple.drawing.2")).toBe(true);
    expect(isDrawingAttachment("com.apple.drawing2")).toBe(true);
    expect(isDrawingAttachment("com.apple.drawing")).toBe(true);
    expect(isDrawingAttachment("com.apple.paper")).toBe(true);
  });

  test("rejects non-drawing UTIs and empty input", () => {
    expect(isDrawingAttachment("public.jpeg")).toBe(false);
    expect(isDrawingAttachment("com.apple.notes.table")).toBe(false);
    expect(isDrawingAttachment("com.apple.paper.doc.pdf")).toBe(false);
    expect(isDrawingAttachment("")).toBe(false);
  });
});

// ============================================================================
// collectDrawingRuns (pure)
// ============================================================================

describe("collectDrawingRuns", () => {
  test("picks only drawing runs, dedups by identifier, preserves order", () => {
    const decoded: DecodedNote = {
      text: "",
      attributeRuns: [
        { length: 5 },
        {
          length: 1,
          attachmentInfo: {
            attachmentIdentifier: "D1",
            typeUti: "com.apple.drawing.2",
          },
        },
        {
          length: 1,
          attachmentInfo: {
            attachmentIdentifier: "IMG",
            typeUti: "public.jpeg",
          },
        },
        {
          length: 1,
          attachmentInfo: {
            attachmentIdentifier: "D2",
            typeUti: "com.apple.drawing.2",
          },
        },
        // duplicate of D1 — should be dropped
        {
          length: 1,
          attachmentInfo: {
            attachmentIdentifier: "D1",
            typeUti: "com.apple.drawing.2",
          },
        },
      ],
    };
    const runs = collectDrawingRuns(decoded);
    expect(runs.map((r) => r.identifier)).toEqual(["D1", "D2"]);
  });

  test("ignores drawing runs with no identifier", () => {
    const decoded: DecodedNote = {
      text: "",
      attributeRuns: [
        { length: 1, attachmentInfo: { typeUti: "com.apple.drawing.2" } },
      ],
    };
    expect(collectDrawingRuns(decoded)).toEqual([]);
  });
});

// ============================================================================
// loadImageBase64 (pure-ish, fs)
// ============================================================================

describe("loadImageBase64", () => {
  // Resolve the on-disk path through the resolver so this test is agnostic to
  // the FallbackImages layout (flat file vs nested <id>/<sub>/FallbackImage.png).
  function renderedImagePath(): string {
    const img = db.getDrawingImage("DRAWING-ATTACH-UUID-001");
    if (!img) throw new Error("fixture drawing image not resolved");
    return img.path;
  }

  test("encodes a small file and reports png mime + size", () => {
    const loaded = loadImageBase64(renderedImagePath());
    if ("tooLarge" in loaded) throw new Error("expected a small image");
    expect(loaded.mimeType).toBe("image/png");
    expect(loaded.bytes).toBeGreaterThan(0);
    const bytes = Buffer.from(loaded.base64, "base64");
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  test("flags files over the cap without encoding them", () => {
    const loaded = loadImageBase64(renderedImagePath(), 1); // 1-byte cap
    expect("tooLarge" in loaded).toBe(true);
  });
});

// ============================================================================
// Notes.listDrawings
// ============================================================================

describe("listDrawings", () => {
  test("reports rendered vs unavailable drawings", () => {
    const drawings = db.listDrawings(handwrittenNoteId);
    expect(drawings).toHaveLength(2);

    const rendered = drawings.find(
      (d) => d.identifier === "DRAWING-ATTACH-UUID-001",
    );
    expect(rendered?.available).toBe(true);
    expect(rendered?.imagePath).toContain("FallbackImages");
    expect(rendered?.typeUti).toBe("com.apple.paper");

    const missing = drawings.find(
      (d) => d.identifier === "DRAWING-ATTACH-UUID-002",
    );
    expect(missing?.available).toBe(false);
    expect(missing?.imagePath).toBeNull();
    expect(missing?.typeUti).toBe("com.apple.drawing.2");
  });

  test("returns [] for a note with no drawings", () => {
    expect(db.listDrawings(noteIdByTitle("Simple Note"))).toEqual([]);
  });
});

// ============================================================================
// Notes.getDrawingImage
// ============================================================================

describe("getDrawingImage", () => {
  test("returns base64 PNG for a rendered drawing", () => {
    const img = db.getDrawingImage("DRAWING-ATTACH-UUID-001");
    expect(img).not.toBeNull();
    expect(img?.mimeType).toBe("image/png");
    expect(img?.base64).toBeTruthy();
    expect(img?.path).toContain("FallbackImages");
  });

  test("returns null for an unrendered / unknown drawing", () => {
    expect(db.getDrawingImage("DRAWING-ATTACH-UUID-002")).toBeNull();
    expect(db.getDrawingImage("NOPE-DOES-NOT-EXIST")).toBeNull();
  });
});

// ============================================================================
// Notes.readWithHandwriting (scatter-gather)
// ============================================================================

describe("readWithHandwriting", () => {
  test("returns markdown plus per-drawing results", () => {
    const result = db.readWithHandwriting(handwrittenNoteId);
    expect(result.meta.title).toBe("Handwritten Note");
    expect(result.markdown).toContain("My handwriting");
    expect(result.drawings).toHaveLength(2);

    const rendered = result.drawings.find(
      (d) => d.identifier === "DRAWING-ATTACH-UUID-001",
    );
    expect(rendered?.available).toBe(true);
    expect(rendered?.base64).toBeTruthy();
    expect(rendered?.error).toBeUndefined();

    const missing = result.drawings.find(
      (d) => d.identifier === "DRAWING-ATTACH-UUID-002",
    );
    expect(missing?.available).toBe(false);
    expect(missing?.base64).toBeUndefined();
    expect(missing?.error).toBeTruthy();
  });

  test("a note without drawings yields an empty drawings array", () => {
    const result = db.readWithHandwriting(noteIdByTitle("Simple Note"));
    expect(result.drawings).toEqual([]);
    expect(result.markdown.length).toBeGreaterThan(0);
  });
});
