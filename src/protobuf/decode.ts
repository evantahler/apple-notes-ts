import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import protobuf from "protobufjs";

export interface DecodedNote {
  text: string;
  attributeRuns: DecodedAttributeRun[];
}

export interface DecodedAttributeRun {
  length: number;
  paragraphStyle?: DecodedParagraphStyle;
  font?: DecodedFont;
  fontWeight?: number;
  underlined?: number;
  strikethrough?: number;
  superscript?: number;
  link?: string;
  color?: DecodedColor;
  attachmentInfo?: DecodedAttachmentInfo;
  unknownIdentifier?: number;
  emphasisStyle?: number;
}

export interface DecodedParagraphStyle {
  styleType?: number;
  alignment?: number;
  indentAmount?: number;
  checklist?: { uuid?: Uint8Array; done?: number };
  blockQuote?: number;
}

export interface DecodedFont {
  fontName?: string;
  pointSize?: number;
  fontHints?: number;
}

export interface DecodedColor {
  red?: number;
  green?: number;
  blue?: number;
  alpha?: number;
}

export interface DecodedAttachmentInfo {
  attachmentIdentifier?: string;
  typeUti?: string;
}

export interface DecodedTable {
  rows: string[][];
}

let cachedRoot: protobuf.Root | null = null;

function getProtoRoot(): protobuf.Root {
  if (cachedRoot) return cachedRoot;
  const protoPath = resolve(import.meta.dir, "notestore.proto");
  cachedRoot = protobuf.loadSync(protoPath);
  return cachedRoot;
}

function toDecodedRun(raw: Record<string, unknown>): DecodedAttributeRun {
  const run: DecodedAttributeRun = {
    length: raw.length as number,
  };

  const ps = raw.paragraphStyle as Record<string, unknown> | undefined;
  if (ps) {
    run.paragraphStyle = {
      styleType: ps.styleType as number | undefined,
      alignment: ps.alignment as number | undefined,
      indentAmount: ps.indentAmount as number | undefined,
      blockQuote: ps.blockQuote as number | undefined,
    };
    const cl = ps.checklist as Record<string, unknown> | undefined;
    if (cl) {
      run.paragraphStyle.checklist = {
        uuid: cl.uuid as Uint8Array | undefined,
        done: cl.done as number | undefined,
      };
    }
  }

  const font = raw.font as Record<string, unknown> | undefined;
  if (font) {
    run.font = {
      fontName: font.fontName as string | undefined,
      pointSize: font.pointSize as number | undefined,
      fontHints: font.fontHints as number | undefined,
    };
  }

  if (raw.fontWeight != null) run.fontWeight = raw.fontWeight as number;
  if (raw.underlined != null) run.underlined = raw.underlined as number;
  if (raw.strikethrough != null)
    run.strikethrough = raw.strikethrough as number;
  if (raw.superscript != null) run.superscript = raw.superscript as number;
  if (raw.link != null) run.link = raw.link as string;
  if (raw.unknownIdentifier != null)
    run.unknownIdentifier = raw.unknownIdentifier as number;
  if (raw.emphasisStyle != null)
    run.emphasisStyle = raw.emphasisStyle as number;

  const color = raw.color as Record<string, unknown> | undefined;
  if (color) {
    run.color = {
      red: color.red as number | undefined,
      green: color.green as number | undefined,
      blue: color.blue as number | undefined,
      alpha: color.alpha as number | undefined,
    };
  }

  const ai = raw.attachmentInfo as Record<string, unknown> | undefined;
  if (ai) {
    run.attachmentInfo = {
      attachmentIdentifier: ai.attachmentIdentifier as string | undefined,
      typeUti: ai.typeUti as string | undefined,
    };
  }

  return run;
}

// Decode a ZMERGEABLEDATA1 blob into a simple table structure.
// The blob is a gzipped MergableDataProto with CRDT entries for rows, columns, and cells.
//
// Table CRDT layout:
//   Entry with custom_map type "com.apple.notes.ICTable" has map entries:
//     crColumns → OrderedSet (column UUID indices in order)
//     crRows    → OrderedSet (row UUID indices in order)
//     cellColumns → Dictionary { colUuidIdx → Dictionary { rowUuidIdx → Note } }
//
// Both OrderedSet attachment.index and Dictionary key.unsigned_integer_value
// are indices into the mergeable_data_object_uuid_item array.
export function decodeMergeableTable(
  blob: Buffer | Uint8Array,
): DecodedTable | null {
  try {
    const decompressed = gunzipSync(blob);
    const root = getProtoRoot();
    const MergableDataProto = root.lookupType("MergableDataProto");
    const message = MergableDataProto.decode(decompressed);
    const obj = MergableDataProto.toObject(message, {
      longs: Number,
      bytes: Uint8Array,
      defaults: false,
    }) as Record<string, unknown>;

    const mdo = obj.mergableDataObject as Record<string, unknown> | undefined;
    const data = mdo?.mergeableDataObjectData as
      | Record<string, unknown>
      | undefined;
    if (!data) return null;

    const entries =
      (data.mergeableDataObjectEntry as Record<string, unknown>[]) || [];
    const keys = (data.mergeableDataObjectKeyItem as string[]) || [];
    const types = (data.mergeableDataObjectTypeItem as string[]) || [];

    // Find the table root entry (custom_map with type "com.apple.notes.ICTable")
    const tableEntry = entries.find((e) => {
      const cm = e.customMap as Record<string, unknown> | undefined;
      if (!cm) return false;
      const typeIdx = cm.type as number | undefined;
      return typeIdx != null && types[typeIdx] === "com.apple.notes.ICTable";
    });
    if (!tableEntry) return null;

    const customMap = tableEntry.customMap as Record<string, unknown>;
    const mapEntries = (customMap.mapEntry as Record<string, unknown>[]) || [];

    // Build lookup: key name → object_index into entries array
    const keyToObjectIndex = new Map<string, number>();
    for (const me of mapEntries) {
      const keyIdx = me.key as number | undefined;
      const value = me.value as Record<string, unknown> | undefined;
      if (keyIdx == null || !value) continue;
      const keyName = keys[keyIdx];
      const objIdx = value.objectIndex as number | undefined;
      if (keyName && objIdx != null) {
        keyToObjectIndex.set(keyName, objIdx);
      }
    }

    const colIdx = keyToObjectIndex.get("crColumns");
    const rowIdx = keyToObjectIndex.get("crRows");
    const cellColIdx = keyToObjectIndex.get("cellColumns");
    if (colIdx == null || rowIdx == null) return null;

    // Get ordered UUID indices for columns and rows
    const colUuidIndices = extractOrderedSetIndices(entries[colIdx]);
    const rowUuidIndices = extractOrderedSetIndices(entries[rowIdx]);
    if (colUuidIndices.length === 0 || rowUuidIndices.length === 0) return null;

    // Build cell map: "colUuidIdx:rowUuidIdx" → cell text
    const cellMap = new Map<string, string>();
    if (cellColIdx != null) {
      buildCellMap(entries, cellColIdx, cellMap);
    }

    // Assemble rows
    const rows: string[][] = [];
    for (const rowUuidIdx of rowUuidIndices) {
      const row: string[] = [];
      for (const colUuidIdx of colUuidIndices) {
        row.push(cellMap.get(`${colUuidIdx}:${rowUuidIdx}`) ?? "");
      }
      rows.push(row);
    }

    return { rows };
  } catch {
    return null;
  }
}

// Extract ordered UUID indices from an OrderedSet entry.
// Each attachment's `index` field is an index into uuid_item.
function extractOrderedSetIndices(
  entry: Record<string, unknown> | undefined,
): number[] {
  if (!entry) return [];
  const orderedSet = entry.orderedSet as Record<string, unknown> | undefined;
  if (!orderedSet) return [];
  const ordering = orderedSet.ordering as Record<string, unknown> | undefined;
  if (!ordering) return [];
  const array = ordering.array as Record<string, unknown> | undefined;
  if (!array) return [];
  const attachments = (array.attachment as Record<string, unknown>[]) || [];
  return attachments.map((a) => (a.index as number) ?? 0);
}

// Navigate cellColumns: Dictionary { colUuidIdx → Dict { rowUuidIdx → Note } }
function buildCellMap(
  entries: Record<string, unknown>[],
  cellColIdx: number,
  cellMap: Map<string, string>,
): void {
  const cellColEntry = entries[cellColIdx];
  if (!cellColEntry) return;

  const dict = cellColEntry.dictionary as Record<string, unknown> | undefined;
  if (!dict) return;
  const elements = (dict.element as Record<string, unknown>[]) || [];

  for (const elem of elements) {
    const colKey = elem.key as Record<string, unknown> | undefined;
    const colValue = elem.value as Record<string, unknown> | undefined;
    if (!colKey || !colValue) continue;

    const colUuidIdx = colKey.unsignedIntegerValue as number | undefined;
    const colObjIdx = colValue.objectIndex as number | undefined;
    if (colUuidIdx == null || colObjIdx == null) continue;

    const rowDictEntry = entries[colObjIdx];
    if (!rowDictEntry) continue;

    const rowDict = rowDictEntry.dictionary as
      | Record<string, unknown>
      | undefined;
    if (!rowDict) continue;

    for (const rowElem of (rowDict.element as Record<string, unknown>[]) ||
      []) {
      const rowKey = rowElem.key as Record<string, unknown> | undefined;
      const rowValue = rowElem.value as Record<string, unknown> | undefined;
      if (!rowKey || !rowValue) continue;

      const rowUuidIdx = rowKey.unsignedIntegerValue as number | undefined;
      const cellObjIdx = rowValue.objectIndex as number | undefined;
      if (rowUuidIdx == null || cellObjIdx == null) continue;

      const cellEntry = entries[cellObjIdx];
      if (!cellEntry) continue;

      const cellNote = cellEntry.note as Record<string, unknown> | undefined;
      if (!cellNote) continue;

      const noteText = (cellNote.noteText as string) || "";
      cellMap.set(`${colUuidIdx}:${rowUuidIdx}`, noteText.replace(/\n$/, ""));
    }
  }
}

export function decodeNoteData(zdata: Buffer | Uint8Array): DecodedNote {
  const decompressed = gunzipSync(zdata);
  const root = getProtoRoot();
  const NoteStoreProto = root.lookupType("NoteStoreProto");
  const message = NoteStoreProto.decode(decompressed);
  const obj = NoteStoreProto.toObject(message, {
    longs: Number,
    bytes: Uint8Array,
    defaults: false,
  }) as Record<string, unknown>;

  const doc = obj.document as Record<string, unknown> | undefined;
  const note = doc?.note as Record<string, unknown> | undefined;

  if (!note) {
    return { text: "", attributeRuns: [] };
  }

  const text = (note.noteText as string) || "";
  const rawRuns = (note.attributeRun as Record<string, unknown>[]) || [];

  return {
    text,
    attributeRuns: rawRuns.map(toDecodedRun),
  };
}
