/**
 * Creates a test NoteStore.sqlite database with realistic data.
 * Run with: bun run tests/fixtures/create-test-db.ts
 *
 * The generated DB is checked into git so tests run without Full Disk Access.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import protobuf from "protobufjs";

const FIXTURE_DIR = dirname(new URL(import.meta.url).pathname);
const DB_PATH = resolve(FIXTURE_DIR, "NoteStore.sqlite");
const PROTO_PATH = resolve(FIXTURE_DIR, "../../src/protobuf/notestore.proto");

// Mac Absolute Time: seconds since 2001-01-01
const MAC_EPOCH_OFFSET = 978307200;
function toMacTime(date: Date): number {
  return date.getTime() / 1000 - MAC_EPOCH_OFFSET;
}

// Entity type IDs (Z_ENT values in Z_PRIMARYKEY)
const ENT_ACCOUNT = 1;
const ENT_FOLDER = 2;
const ENT_NOTE = 3;
const ENT_NOTE_DATA = 4;
const ENT_ATTACHMENT = 5;

// Load proto schema for encoding
const root = protobuf.loadSync(PROTO_PATH);
const NoteStoreProto = root.lookupType("NoteStoreProto");

function encodeNote(
  noteText: string,
  attributeRuns: Record<string, unknown>[],
): Buffer {
  const message = NoteStoreProto.create({
    document: {
      version: 1,
      note: {
        noteText,
        attributeRun: attributeRuns,
      },
    },
  });
  const buffer = NoteStoreProto.encode(message).finish();
  return Buffer.from(gzipSync(buffer));
}

// Helper to create a simple run (body text, no special formatting)
function bodyRun(length: number): Record<string, unknown> {
  return { length };
}

// Helper to create a title run
function titleRun(length: number): Record<string, unknown> {
  return {
    length,
    paragraphStyle: { styleType: 0 },
  };
}

// Helper for heading run
function headingRun(length: number): Record<string, unknown> {
  return {
    length,
    paragraphStyle: { styleType: 1 },
  };
}

// Helper for subheading run
function subheadingRun(length: number): Record<string, unknown> {
  return {
    length,
    paragraphStyle: { styleType: 2 },
  };
}

// Helper for bold run
function boldRun(length: number): Record<string, unknown> {
  return { length, fontWeight: 1 };
}

// Helper for italic run
function italicRun(length: number): Record<string, unknown> {
  return { length, fontWeight: 2 };
}

// Helper for bold+italic run
function boldItalicRun(length: number): Record<string, unknown> {
  return { length, fontWeight: 3 };
}

// Helper for strikethrough run
function strikethroughRun(length: number): Record<string, unknown> {
  return { length, strikethrough: 1 };
}

// Helper for underline run
function underlineRun(length: number): Record<string, unknown> {
  return { length, underlined: 1 };
}

// Helper for link run
function linkRun(length: number, url: string): Record<string, unknown> {
  return { length, link: url };
}

// Helper for code (monospace) run
function codeRun(length: number): Record<string, unknown> {
  return {
    length,
    paragraphStyle: { styleType: 4 },
  };
}

// Helper for bullet list run
function bulletRun(
  length: number,
  indent: number = 0,
): Record<string, unknown> {
  return {
    length,
    paragraphStyle: { styleType: 100, indentAmount: indent },
  };
}

// Helper for numbered list run
function numberedRun(
  length: number,
  indent: number = 0,
): Record<string, unknown> {
  return {
    length,
    paragraphStyle: { styleType: 102, indentAmount: indent },
  };
}

// Helper for checklist run
function checklistRun(
  length: number,
  done: boolean,
  indent: number = 0,
): Record<string, unknown> {
  return {
    length,
    paragraphStyle: {
      styleType: 103,
      indentAmount: indent,
      checklist: {
        uuid: new Uint8Array(16),
        done: done ? 1 : 0,
      },
    },
  };
}

// Helper for block quote run
function blockQuoteRun(length: number): Record<string, unknown> {
  return {
    length,
    paragraphStyle: { blockQuote: 1 },
  };
}

// Helper for inline code run (monospace font hint, not block-level)
function inlineCodeRun(length: number): Record<string, unknown> {
  return {
    length,
    font: { fontHints: 1 },
  };
}

// Helper for attachment run
function attachmentRun(
  identifier: string,
  typeUti: string,
): Record<string, unknown> {
  return {
    length: 1, // U+FFFC replacement character
    attachmentInfo: {
      attachmentIdentifier: identifier,
      typeUti,
    },
  };
}

// ============================================================================
// Build the database
// ============================================================================

// Delete existing DB
try {
  Bun.file(DB_PATH).delete;
  const { unlinkSync } = await import("node:fs");
  try {
    unlinkSync(DB_PATH);
  } catch {}
  try {
    unlinkSync(`${DB_PATH}-wal`);
  } catch {}
  try {
    unlinkSync(`${DB_PATH}-shm`);
  } catch {}
} catch {}

const db = new Database(DB_PATH);

// Create schema
db.exec(`
  -- Entity type registry (mimics Core Data Z_PRIMARYKEY)
  CREATE TABLE Z_PRIMARYKEY (
    Z_ENT INTEGER PRIMARY KEY,
    Z_NAME VARCHAR,
    Z_SUPER INTEGER,
    Z_MAX INTEGER
  );

  -- Main object table (accounts, folders, notes, attachments all live here)
  CREATE TABLE ZICCLOUDSYNCINGOBJECT (
    Z_PK INTEGER PRIMARY KEY,
    Z_ENT INTEGER,
    Z_OPT INTEGER,

    -- Account fields
    ZNAME VARCHAR,

    -- Folder fields
    ZTITLE2 VARCHAR,
    ZPARENT INTEGER,
    ZMARKEDFORDELETION INTEGER DEFAULT 0,

    -- Note fields
    ZTITLE1 VARCHAR,
    ZSNIPPET VARCHAR,
    ZFOLDER INTEGER,
    ZACCOUNT2 INTEGER,
    ZCREATIONDATE1 TIMESTAMP,
    ZMODIFICATIONDATE1 TIMESTAMP,
    ZISPASSWORDPROTECTED INTEGER DEFAULT 0,

    -- Attachment fields
    ZIDENTIFIER VARCHAR,
    ZFILENAME VARCHAR,
    ZTYPEUTI VARCHAR,
    ZNOTE1 INTEGER,
    ZMEDIA INTEGER,
    ZMERGEABLEDATA1 BLOB
  );

  -- Note data table (contains the protobuf ZDATA blobs)
  CREATE TABLE ZICNOTEDATA (
    Z_PK INTEGER PRIMARY KEY,
    Z_ENT INTEGER,
    Z_OPT INTEGER,
    ZNOTE INTEGER,
    ZDATA BLOB
  );
`);

// Register entity types
db.exec(`
  INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME, Z_SUPER, Z_MAX) VALUES
    (${ENT_ACCOUNT}, 'ICAccount', 0, 0),
    (${ENT_FOLDER}, 'ICFolder', 0, 0),
    (${ENT_NOTE}, 'ICNote', 0, 0),
    (${ENT_NOTE_DATA}, 'ICNoteData', 0, 0),
    (${ENT_ATTACHMENT}, 'ICAttachment', 0, 0);
`);

// ============================================================================
// Accounts
// ============================================================================
const now = new Date("2025-06-15T10:00:00Z");
const yesterday = new Date("2025-06-14T10:00:00Z");
const lastWeek = new Date("2025-06-08T10:00:00Z");
const lastMonth = new Date("2025-05-15T10:00:00Z");

// Account 1: iCloud
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, Z_ENT, Z_OPT, ZNAME)
   VALUES (1, ${ENT_ACCOUNT}, 1, 'iCloud')`,
).run();

// Account 2: On My Mac
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, Z_ENT, Z_OPT, ZNAME)
   VALUES (2, ${ENT_ACCOUNT}, 1, 'On My Mac')`,
).run();

// ============================================================================
// Folders
// ============================================================================

// Folder 1: Notes (iCloud)
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, Z_ENT, Z_OPT, ZTITLE2, ZPARENT, ZMARKEDFORDELETION)
   VALUES (10, ${ENT_FOLDER}, 1, 'Notes', 1, 0)`,
).run();

// Folder 2: Work (iCloud)
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, Z_ENT, Z_OPT, ZTITLE2, ZPARENT, ZMARKEDFORDELETION)
   VALUES (11, ${ENT_FOLDER}, 1, 'Work', 1, 0)`,
).run();

// Folder 3: Personal (On My Mac)
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, Z_ENT, Z_OPT, ZTITLE2, ZPARENT, ZMARKEDFORDELETION)
   VALUES (12, ${ENT_FOLDER}, 1, 'Personal', 2, 0)`,
).run();

// ============================================================================
// Notes
// ============================================================================

let notePk = 100;
let noteDataPk = 200;

function insertNote(opts: {
  title: string;
  snippet: string;
  folderId: number;
  createdAt: Date;
  modifiedAt: Date;
  noteText: string;
  attributeRuns: Record<string, unknown>[];
  isPasswordProtected?: boolean;
  skipZdata?: boolean;
}) {
  const pk = notePk++;
  const dataPk = noteDataPk++;

  // Validate that attribute run lengths sum to text length
  if (!opts.skipZdata && opts.noteText.length > 0) {
    const totalRunLen = opts.attributeRuns.reduce(
      (sum, r) => sum + (r.length as number),
      0,
    );
    if (totalRunLen !== opts.noteText.length) {
      throw new Error(
        `Run length mismatch for "${opts.title}": ` +
          `runs sum to ${totalRunLen} but text is ${opts.noteText.length} chars`,
      );
    }
  }

  db.query(
    `INSERT INTO ZICCLOUDSYNCINGOBJECT
     (Z_PK, Z_ENT, Z_OPT, ZTITLE1, ZSNIPPET, ZFOLDER, ZCREATIONDATE1, ZMODIFICATIONDATE1, ZISPASSWORDPROTECTED)
     VALUES (?, ${ENT_NOTE}, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pk,
    opts.title,
    opts.snippet,
    opts.folderId,
    toMacTime(opts.createdAt),
    toMacTime(opts.modifiedAt),
    opts.isPasswordProtected ? 1 : 0,
  );

  const zdata = opts.skipZdata
    ? null
    : encodeNote(opts.noteText, opts.attributeRuns);

  db.query(
    `INSERT INTO ZICNOTEDATA (Z_PK, Z_ENT, Z_OPT, ZNOTE, ZDATA)
     VALUES (?, ${ENT_NOTE_DATA}, 1, ?, ?)`,
  ).run(dataPk, pk, zdata);

  return pk;
}

// Note 1: Simple plain text
// "Simple Note\n" = 12, "This is a simple plain text note.\n" = 34, "It has multiple lines.\n" = 23
insertNote({
  title: "Simple Note",
  snippet: "This is a simple plain text note.",
  folderId: 10,
  createdAt: lastMonth,
  modifiedAt: lastWeek,
  noteText:
    "Simple Note\nThis is a simple plain text note.\nIt has multiple lines.\n",
  attributeRuns: [titleRun(12), bodyRun(34), bodyRun(23)],
});

// Note 2: Rich formatting
// "Formatted Note\n" = 15
// "This has " = 9, "bold" = 4, " and " = 5, "italic" = 6, " and " = 5, "bold italic" = 11, " text.\n" = 7
// "Also " = 5, "strikethrough" = 13, " and " = 5, "underline" = 9, ".\n" = 2
insertNote({
  title: "Formatted Note",
  snippet: "A note with bold, italic, and more.",
  folderId: 10,
  createdAt: lastWeek,
  modifiedAt: yesterday,
  noteText:
    "Formatted Note\nThis has bold and italic and bold italic text.\nAlso strikethrough and underline.\n",
  attributeRuns: [
    titleRun(15),
    bodyRun(9),
    boldRun(4),
    bodyRun(5),
    italicRun(6),
    bodyRun(5),
    boldItalicRun(11),
    bodyRun(7),
    bodyRun(5),
    strikethroughRun(13),
    bodyRun(5),
    underlineRun(9),
    bodyRun(2),
  ],
});

// Note 3: Headings
insertNote({
  title: "Headings Test",
  snippet: "Testing headings",
  folderId: 11,
  createdAt: lastWeek,
  modifiedAt: now,
  noteText: "Headings Test\nMain Section\nSub Section\nBody text here.\n",
  attributeRuns: [
    titleRun(14), // "Headings Test\n"
    headingRun(13), // "Main Section\n"
    subheadingRun(12), // "Sub Section\n"
    bodyRun(16), // "Body text here.\n"
  ],
});

// Note 4: Lists
insertNote({
  title: "Lists Note",
  snippet: "Various list types",
  folderId: 11,
  createdAt: yesterday,
  modifiedAt: now,
  noteText:
    "Lists Note\nFirst bullet\nSecond bullet\nNested bullet\nFirst numbered\nSecond numbered\n",
  attributeRuns: [
    titleRun(11), // "Lists Note\n"
    bulletRun(13), // "First bullet\n"
    bulletRun(14), // "Second bullet\n"
    bulletRun(14, 1), // "Nested bullet\n" (indent=1)
    numberedRun(15), // "First numbered\n"
    numberedRun(16), // "Second numbered\n"
  ],
});

// Note 5: Checklists
insertNote({
  title: "Todo List",
  snippet: "Task tracking",
  folderId: 11,
  createdAt: yesterday,
  modifiedAt: now,
  noteText: "Todo List\nBuy groceries\nClean house\nWrite code\nReview PR\n",
  attributeRuns: [
    titleRun(10), // "Todo List\n"
    checklistRun(14, true), // "Buy groceries\n" (done)
    checklistRun(12, false), // "Clean house\n" (not done)
    checklistRun(11, true), // "Write code\n" (done)
    checklistRun(10, false), // "Review PR\n" (not done)
  ],
});

// Note 6: Code blocks
// "Code Example\n"=13 "Here is some code:\n"=19 "function hello() {\n"=19 "  return 'world';\n"=18 "}\n"=2 "And that's it.\n"=15
insertNote({
  title: "Code Example",
  snippet: "Some code",
  folderId: 10,
  createdAt: lastWeek,
  modifiedAt: yesterday,
  noteText:
    "Code Example\nHere is some code:\nfunction hello() {\n  return 'world';\n}\nAnd that's it.\n",
  attributeRuns: [
    titleRun(13),
    bodyRun(19),
    codeRun(19),
    codeRun(18),
    codeRun(2),
    bodyRun(15),
  ],
});

// Note 7: Links
insertNote({
  title: "Links Note",
  snippet: "Links to websites",
  folderId: 12,
  createdAt: lastMonth,
  modifiedAt: lastWeek,
  noteText:
    "Links Note\nVisit Example for more info.\nAlso check Other Site.\n",
  attributeRuns: [
    titleRun(11), // "Links Note\n"
    bodyRun(6), // "Visit "
    linkRun(7, "https://example.com"), // "Example"
    bodyRun(16), // " for more info.\n"
    bodyRun(11), // "Also check "
    linkRun(10, "https://other-site.com"), // "Other Site"
    bodyRun(2), // ".\n"
  ],
});

// Note 8: Block quotes
// "Quotes Note\n" = 12, "Someone once said:\n" = 19, "To be or not to be.\n" = 20, "That is the question.\n" = 22
insertNote({
  title: "Quotes Note",
  snippet: "Some quotes",
  folderId: 12,
  createdAt: lastWeek,
  modifiedAt: yesterday,
  noteText:
    "Quotes Note\nSomeone once said:\nTo be or not to be.\nThat is the question.\n",
  attributeRuns: [titleRun(12), bodyRun(19), blockQuoteRun(20), bodyRun(22)],
});

// Note 9: Large note (for pagination tests)
const largeLines: string[] = ["Large Note"];
const largeRuns: Record<string, unknown>[] = [titleRun(11)]; // "Large Note\n"
for (let i = 1; i <= 500; i++) {
  const line = `Line ${i}: This is line number ${i} of the large note for pagination testing.`;
  largeLines.push(line);
  largeRuns.push(bodyRun(line.length + 1)); // +1 for \n
}
const largeText = `${largeLines.join("\n")}\n`;

insertNote({
  title: "Large Note",
  snippet: "Line 1: This is line number 1 of the large note",
  folderId: 10,
  createdAt: lastMonth,
  modifiedAt: now,
  noteText: largeText,
  attributeRuns: largeRuns,
});

// Note 10: Password protected note
insertNote({
  title: "Secret Note",
  snippet: "",
  folderId: 12,
  createdAt: lastMonth,
  modifiedAt: lastMonth,
  noteText: "",
  attributeRuns: [],
  isPasswordProtected: true,
  skipZdata: true,
});

// Note 11: Note with attachment reference
const attachmentId = "ATTACH-UUID-001";
insertNote({
  title: "Note With Image",
  snippet: "Has an image attachment",
  folderId: 10,
  createdAt: yesterday,
  modifiedAt: now,
  noteText: "Note With Image\nHere is an image:\n\uFFFCAnd some text after.\n",
  attributeRuns: [
    titleRun(16), // "Note With Image\n"
    bodyRun(18), // "Here is an image:\n"
    attachmentRun(attachmentId, "public.jpeg"), // U+FFFC
    bodyRun(21), // "And some text after.\n"
  ],
});

// Insert the attachment record (linked to a media row via ZMEDIA)
const mediaPk = 301;
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT
   (Z_PK, Z_ENT, Z_OPT, ZIDENTIFIER, ZFILENAME, ZTYPEUTI, ZNOTE1, ZMEDIA)
   VALUES (300, ${ENT_ATTACHMENT}, 1, ?, NULL, 'public.jpeg', ?, ?)`,
).run(attachmentId, 110, mediaPk); // note 11 (0-indexed from 100): pk=110

// Insert the media row (the file on disk uses THIS row's identifier)
const mediaId = "MEDIA-UUID-001";
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT
   (Z_PK, Z_ENT, Z_OPT, ZIDENTIFIER, ZFILENAME)
   VALUES (?, ${ENT_ATTACHMENT}, 1, ?, 'photo.jpg')`,
).run(mediaPk, mediaId);

// Note 12: Inline code
// "Inline Code Note\n" = 17, "Use the " = 8, "console.log" = 11, " function in your code.\n" = 24
insertNote({
  title: "Inline Code Note",
  snippet: "Has inline code",
  folderId: 11,
  createdAt: now,
  modifiedAt: now,
  noteText: "Inline Code Note\nUse the console.log function in your code.\n",
  attributeRuns: [titleRun(17), bodyRun(8), inlineCodeRun(11), bodyRun(24)],
});

// Note 13: Note with PDF (Paper doc) attachment
const pdfAttachmentId = "PDF-ATTACH-UUID-001";
const pdfNotePk = insertNote({
  title: "Note With PDF",
  snippet: "Has a scanned PDF",
  folderId: 10,
  createdAt: yesterday,
  modifiedAt: now,
  noteText: "Note With PDF\nSee attached document:\n\uFFFC\n",
  attributeRuns: [
    titleRun(14), // "Note With PDF\n"
    bodyRun(23), // "See attached document:\n"
    attachmentRun(pdfAttachmentId, "com.apple.paper.doc.pdf"),
    bodyRun(1), // "\n"
  ],
});

// PDF attachment — no ZMEDIA, resolved via FallbackPDFs directory
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT
   (Z_PK, Z_ENT, Z_OPT, ZIDENTIFIER, ZFILENAME, ZTYPEUTI, ZNOTE1)
   VALUES (302, ${ENT_ATTACHMENT}, 1, ?, NULL, 'com.apple.paper.doc.pdf', ?)`,
).run(pdfAttachmentId, pdfNotePk);

// Note 14: Note with embedded table
const MergableDataProto = root.lookupType("MergableDataProto");

// Build a 2-column, 3-row table: header (Name, Value), rows (Alpha/100, Beta/200)
function encodeTableBlob(): Buffer {
  // UUID items (raw 16-byte UUIDs) for columns and rows
  // Index 0: col0 UUID, Index 1: col1 UUID
  // Index 2: row0 UUID, Index 3: row1 UUID, Index 4: row2 UUID
  const uuid0 = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const uuid1 = new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const uuid2 = new Uint8Array([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const uuid3 = new Uint8Array([4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const uuid4 = new Uint8Array([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  // Keys: crColumns, crRows, cellColumns
  // Types: com.apple.notes.ICTable
  const keyItems = ["crColumns", "crRows", "cellColumns"];
  const typeItems = ["com.apple.notes.ICTable"];
  const uuidItems = [uuid0, uuid1, uuid2, uuid3, uuid4];

  // Cell notes for each cell (6 cells: 3 rows x 2 cols)
  const cellTexts = ["Name", "Value", "Alpha", "100", "Beta", "200"];
  const cellNoteEntries = cellTexts.map((text) => ({
    note: {
      noteText: `${text}\n`,
      attributeRun: [{ length: text.length + 1 }],
    },
  }));

  // Entry indices layout:
  //  0: table root (custom_map)
  //  1: crColumns ordered set
  //  2: crRows ordered set
  //  3: cellColumns dictionary (col → row dict)
  //  4: col0 row dictionary
  //  5: col1 row dictionary
  //  6-11: cell notes (Name, Value, Alpha, 100, Beta, 200)

  const entries = [
    // Entry 0: table root
    {
      customMap: {
        type: 0, // index into typeItems → "com.apple.notes.ICTable"
        mapEntry: [
          { key: 0, value: { objectIndex: 1 } }, // crColumns → entry 1
          { key: 1, value: { objectIndex: 2 } }, // crRows → entry 2
          { key: 2, value: { objectIndex: 3 } }, // cellColumns → entry 3
        ],
      },
    },
    // Entry 1: crColumns ordered set (2 columns: uuid indices 0, 1)
    {
      orderedSet: {
        ordering: {
          array: {
            contents: {
              noteText: "\u{FFFC}\u{FFFC}",
              attributeRun: [{ length: 2 }],
            },
            attachment: [
              { index: 0, uuid: uuid0 },
              { index: 1, uuid: uuid1 },
            ],
          },
        },
      },
    },
    // Entry 2: crRows ordered set (3 rows: uuid indices 2, 3, 4)
    {
      orderedSet: {
        ordering: {
          array: {
            contents: {
              noteText: "\u{FFFC}\u{FFFC}\u{FFFC}",
              attributeRun: [{ length: 3 }],
            },
            attachment: [
              { index: 2, uuid: uuid2 },
              { index: 3, uuid: uuid3 },
              { index: 4, uuid: uuid4 },
            ],
          },
        },
      },
    },
    // Entry 3: cellColumns dictionary
    // Maps col uuid index → entry with row dictionary
    {
      dictionary: {
        element: [
          {
            key: { unsignedIntegerValue: 0 }, // col0 (uuid index 0)
            value: { objectIndex: 4 },         // → entry 4
          },
          {
            key: { unsignedIntegerValue: 1 }, // col1 (uuid index 1)
            value: { objectIndex: 5 },         // → entry 5
          },
        ],
      },
    },
    // Entry 4: col0 row dictionary (Name, Alpha, Beta)
    {
      dictionary: {
        element: [
          {
            key: { unsignedIntegerValue: 2 }, // row0 (uuid index 2)
            value: { objectIndex: 6 },         // → "Name"
          },
          {
            key: { unsignedIntegerValue: 3 }, // row1 (uuid index 3)
            value: { objectIndex: 8 },         // → "Alpha"
          },
          {
            key: { unsignedIntegerValue: 4 }, // row2 (uuid index 4)
            value: { objectIndex: 10 },        // → "Beta"
          },
        ],
      },
    },
    // Entry 5: col1 row dictionary (Value, 100, 200)
    {
      dictionary: {
        element: [
          {
            key: { unsignedIntegerValue: 2 }, // row0 (uuid index 2)
            value: { objectIndex: 7 },         // → "Value"
          },
          {
            key: { unsignedIntegerValue: 3 }, // row1 (uuid index 3)
            value: { objectIndex: 9 },         // → "100"
          },
          {
            key: { unsignedIntegerValue: 4 }, // row2 (uuid index 4)
            value: { objectIndex: 11 },        // → "200"
          },
        ],
      },
    },
    // Entries 6-11: cell notes
    ...cellNoteEntries,
  ];

  const proto = MergableDataProto.create({
    mergableDataObject: {
      version: 1,
      mergeableDataObjectData: {
        mergeableDataObjectEntry: entries,
        mergeableDataObjectKeyItem: keyItems,
        mergeableDataObjectTypeItem: typeItems,
        mergeableDataObjectUuidItem: uuidItems,
      },
    },
  });

  const buffer = MergableDataProto.encode(proto).finish();
  return Buffer.from(gzipSync(buffer));
}

const tableAttachmentId = "TABLE-ATTACH-UUID-001";
const tableNotePk = insertNote({
  title: "Note With Table",
  snippet: "Has an embedded table",
  folderId: 11,
  createdAt: yesterday,
  modifiedAt: now,
  noteText: "Note With Table\nHere is a table:\n\uFFFC\n",
  attributeRuns: [
    titleRun(16), // "Note With Table\n"
    bodyRun(17),  // "Here is a table:\n"
    attachmentRun(tableAttachmentId, "com.apple.notes.table"),
    bodyRun(1),   // "\n"
  ],
});

// Insert the table attachment with ZMERGEABLEDATA1
const tableBlob = encodeTableBlob();
db.query(
  `INSERT INTO ZICCLOUDSYNCINGOBJECT
   (Z_PK, Z_ENT, Z_OPT, ZIDENTIFIER, ZTYPEUTI, ZNOTE1, ZMERGEABLEDATA1)
   VALUES (303, ${ENT_ATTACHMENT}, 1, ?, 'com.apple.notes.table', ?, ?)`,
).run(tableAttachmentId, tableNotePk, tableBlob);

// ============================================================================
// Create fake attachment files
// ============================================================================

// Image attachment: file lives under the media identifier directory
const attachDir = resolve(FIXTURE_DIR, "Accounts", mediaId);
mkdirSync(attachDir, { recursive: true });
writeFileSync(resolve(attachDir, "photo.jpg"), "fake-jpeg-data-for-testing");

// PDF attachment: file lives in FallbackPDFs directory
const pdfDir = resolve(FIXTURE_DIR, "FallbackPDFs", pdfAttachmentId);
mkdirSync(pdfDir, { recursive: true });
writeFileSync(resolve(pdfDir, "FallbackPDF.pdf"), "fake-pdf-data-for-testing");

// ============================================================================
// Done
// ============================================================================

db.close();
console.log(`Created test database at ${DB_PATH}`);
console.log("Notes created: 14");
console.log("Accounts: iCloud, On My Mac");
console.log("Folders: Notes, Work, Personal");
