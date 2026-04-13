import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import protobuf from "protobufjs";
import {
  decodeMergeableTable,
  decodeNoteData,
} from "../src/protobuf/decode.ts";

const PROTO_PATH = resolve(import.meta.dir, "../src/protobuf/notestore.proto");
const root = protobuf.loadSync(PROTO_PATH);
const NoteStoreProto = root.lookupType("NoteStoreProto");

function makeZdata(
  noteText: string,
  attributeRuns: Record<string, unknown>[],
): Buffer {
  const msg = NoteStoreProto.create({
    document: {
      version: 1,
      note: { noteText, attributeRun: attributeRuns },
    },
  });
  return Buffer.from(gzipSync(NoteStoreProto.encode(msg).finish()));
}

describe("decodeNoteData", () => {
  test("decodes plain text note", () => {
    const zdata = makeZdata("Hello world\n", [{ length: 12 }]);
    const result = decodeNoteData(zdata);

    expect(result.text).toBe("Hello world\n");
    expect(result.attributeRuns).toHaveLength(1);
    expect(result.attributeRuns[0]?.length).toBe(12);
  });

  test("decodes empty note", () => {
    const zdata = makeZdata("", []);
    const result = decodeNoteData(zdata);

    expect(result.text).toBe("");
    expect(result.attributeRuns).toHaveLength(0);
  });

  test("decodes note with bold formatting", () => {
    const zdata = makeZdata("Hello bold\n", [
      { length: 6 },
      { length: 4, fontWeight: 1 },
      { length: 1 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns).toHaveLength(3);
    expect(result.attributeRuns[1]?.fontWeight).toBe(1);
  });

  test("decodes note with italic formatting", () => {
    const zdata = makeZdata("Hello italic\n", [
      { length: 6 },
      { length: 6, fontWeight: 2 },
      { length: 1 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[1]?.fontWeight).toBe(2);
  });

  test("decodes note with bold+italic formatting", () => {
    const zdata = makeZdata("Hello both\n", [
      { length: 6 },
      { length: 4, fontWeight: 3 },
      { length: 1 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[1]?.fontWeight).toBe(3);
  });

  test("decodes paragraph styles", () => {
    const zdata = makeZdata("Title\nHeading\nBody\n", [
      { length: 6, paragraphStyle: { styleType: 0 } },
      { length: 8, paragraphStyle: { styleType: 1 } },
      { length: 5 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.paragraphStyle?.styleType).toBe(0);
    expect(result.attributeRuns[1]?.paragraphStyle?.styleType).toBe(1);
    expect(result.attributeRuns[2]?.paragraphStyle).toBeUndefined();
  });

  test("decodes checklist items", () => {
    const uuid = new Uint8Array(16);
    const zdata = makeZdata("Done\nNot done\n", [
      {
        length: 5,
        paragraphStyle: {
          styleType: 103,
          checklist: { uuid, done: 1 },
        },
      },
      {
        length: 9,
        paragraphStyle: {
          styleType: 103,
          checklist: { uuid, done: 0 },
        },
      },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.paragraphStyle?.checklist?.done).toBe(1);
    expect(result.attributeRuns[1]?.paragraphStyle?.checklist?.done).toBe(0);
  });

  test("decodes strikethrough and underline", () => {
    const zdata = makeZdata("ab", [
      { length: 1, strikethrough: 1 },
      { length: 1, underlined: 1 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.strikethrough).toBe(1);
    expect(result.attributeRuns[1]?.underlined).toBe(1);
  });

  test("decodes links", () => {
    const zdata = makeZdata("click here\n", [
      { length: 10, link: "https://example.com" },
      { length: 1 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.link).toBe("https://example.com");
  });

  test("decodes attachment info", () => {
    const zdata = makeZdata("\uFFFC\n", [
      {
        length: 1,
        attachmentInfo: {
          attachmentIdentifier: "UUID-123",
          typeUti: "public.jpeg",
        },
      },
      { length: 1 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.attachmentInfo?.attachmentIdentifier).toBe(
      "UUID-123",
    );
    expect(result.attributeRuns[0]?.attachmentInfo?.typeUti).toBe(
      "public.jpeg",
    );
  });

  test("decodes monospace font hint", () => {
    const zdata = makeZdata("code\n", [
      { length: 4, font: { fontHints: 1 } },
      { length: 1 },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.font?.fontHints).toBe(1);
  });

  test("decodes block quote", () => {
    const zdata = makeZdata("quoted\n", [
      { length: 7, paragraphStyle: { blockQuote: 1 } },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.paragraphStyle?.blockQuote).toBe(1);
  });

  test("decodes indent amount", () => {
    const zdata = makeZdata("nested\n", [
      {
        length: 7,
        paragraphStyle: { styleType: 100, indentAmount: 2 },
      },
    ]);
    const result = decodeNoteData(zdata);

    expect(result.attributeRuns[0]?.paragraphStyle?.indentAmount).toBe(2);
  });

  test("handles missing document gracefully", () => {
    const msg = NoteStoreProto.create({});
    const zdata = Buffer.from(gzipSync(NoteStoreProto.encode(msg).finish()));
    const result = decodeNoteData(zdata);

    expect(result.text).toBe("");
    expect(result.attributeRuns).toHaveLength(0);
  });
});

describe("decodeMergeableTable", () => {
  const MergableDataProto = root.lookupType("MergableDataProto");

  function makeTableBlob(cells: string[][]): Buffer {
    const numCols = cells[0]?.length ?? 0;
    const numRows = cells.length;

    // Create UUIDs for columns and rows
    const uuidItems: Uint8Array[] = [];
    for (let i = 0; i < numCols + numRows; i++) {
      const uuid = new Uint8Array(16);
      uuid[0] = i + 1;
      uuidItems.push(uuid);
    }

    // Cell note entries
    const cellNoteEntries = cells.flat().map((text) => ({
      note: {
        noteText: `${text}\n`,
        attributeRun: [{ length: text.length + 1 }],
      },
    }));

    // First 6 entries are structural, then cell notes follow
    const BASE_ENTRY_COUNT = 3 + 1 + numCols; // root + colSet + rowSet + cellCols + per-col dicts

    // Build per-column row dictionaries
    const colDictEntries = [];
    for (let c = 0; c < numCols; c++) {
      const elements = [];
      for (let r = 0; r < numRows; r++) {
        elements.push({
          key: { unsignedIntegerValue: numCols + r }, // row uuid index
          value: { objectIndex: BASE_ENTRY_COUNT + r * numCols + c },
        });
      }
      colDictEntries.push({ dictionary: { element: elements } });
    }

    // cellColumns dictionary
    const cellColElements = [];
    for (let c = 0; c < numCols; c++) {
      cellColElements.push({
        key: { unsignedIntegerValue: c }, // col uuid index
        value: { objectIndex: 3 + 1 + c }, // per-col dict entry index
      });
    }

    const entries = [
      // Entry 0: table root
      {
        customMap: {
          type: 0,
          mapEntry: [
            { key: 0, value: { objectIndex: 1 } },
            { key: 1, value: { objectIndex: 2 } },
            { key: 2, value: { objectIndex: 3 } },
          ],
        },
      },
      // Entry 1: crColumns
      {
        orderedSet: {
          ordering: {
            array: {
              contents: {
                noteText: "\u{FFFC}".repeat(numCols),
                attributeRun: [{ length: numCols }],
              },
              attachment: Array.from({ length: numCols }, (_, i) => ({
                index: i,
                uuid: uuidItems[i],
              })),
            },
          },
        },
      },
      // Entry 2: crRows
      {
        orderedSet: {
          ordering: {
            array: {
              contents: {
                noteText: "\u{FFFC}".repeat(numRows),
                attributeRun: [{ length: numRows }],
              },
              attachment: Array.from({ length: numRows }, (_, i) => ({
                index: numCols + i,
                uuid: uuidItems[numCols + i],
              })),
            },
          },
        },
      },
      // Entry 3: cellColumns dictionary
      { dictionary: { element: cellColElements } },
      // Entries 4+: per-column row dictionaries
      ...colDictEntries,
      // Cell note entries
      ...cellNoteEntries,
    ];

    const proto = MergableDataProto.create({
      mergableDataObject: {
        version: 1,
        mergeableDataObjectData: {
          mergeableDataObjectEntry: entries,
          mergeableDataObjectKeyItem: ["crColumns", "crRows", "cellColumns"],
          mergeableDataObjectTypeItem: ["com.apple.notes.ICTable"],
          mergeableDataObjectUuidItem: uuidItems,
        },
      },
    });

    return Buffer.from(gzipSync(MergableDataProto.encode(proto).finish()));
  }

  test("decodes a 2x3 table", () => {
    const blob = makeTableBlob([
      ["Name", "Value"],
      ["Alpha", "100"],
      ["Beta", "200"],
    ]);

    const table = decodeMergeableTable(blob);
    expect(table).not.toBeNull();
    expect(table?.rows).toEqual([
      ["Name", "Value"],
      ["Alpha", "100"],
      ["Beta", "200"],
    ]);
  });

  test("decodes a single-cell table", () => {
    const blob = makeTableBlob([["Hello"]]);
    const table = decodeMergeableTable(blob);
    expect(table).not.toBeNull();
    expect(table?.rows).toEqual([["Hello"]]);
  });

  test("returns null for invalid data", () => {
    const blob = Buffer.from(gzipSync(Buffer.from("not a protobuf")));
    const table = decodeMergeableTable(blob);
    expect(table).toBeNull();
  });

  test("returns null for non-table mergeable data", () => {
    const proto = MergableDataProto.create({
      mergableDataObject: {
        version: 1,
        mergeableDataObjectData: {
          mergeableDataObjectEntry: [{ registerLatest: { contents: {} } }],
          mergeableDataObjectKeyItem: [],
          mergeableDataObjectTypeItem: [],
        },
      },
    });
    const blob = Buffer.from(
      gzipSync(MergableDataProto.encode(proto).finish()),
    );
    const table = decodeMergeableTable(blob);
    expect(table).toBeNull();
  });
});
