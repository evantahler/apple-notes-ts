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
// Table CRDT layout (real Apple Notes):
//   Entry with custom_map type "com.apple.notes.ICTable" has map entries:
//     crColumns → OrderedSet (column UUIDs in display order)
//     crRows    → OrderedSet (row UUIDs in display order)
//     cellColumns → Dictionary { NSUUID(col) → Dictionary { NSUUID(row) → Note } }
//
// Dictionary keys use objectIndex → NSUUID wrapper entry → UUIDIndex → uuid_item[].
// OrderedSet attachments carry raw uuid bytes directly.
// We match them by converting both to hex strings.
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
    const uuidItems = (data.mergeableDataObjectUuidItem as Uint8Array[]) || [];

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

    // Get ordered UUID hex strings for columns and rows.
    // The ordered set's attachment UUIDs are "internal" identifiers. The
    // ordering.contents dictionary maps them to "external" UUIDs that the
    // cellColumns dictionary uses as keys.
    const colUuids = extractOrderedSetUuids(
      entries[colIdx],
      entries,
      keys,
      uuidItems,
    );
    const rowUuids = extractOrderedSetUuids(
      entries[rowIdx],
      entries,
      keys,
      uuidItems,
    );
    if (colUuids.length === 0 || rowUuids.length === 0) return null;

    // Build cell map: "colUuidHex:rowUuidHex" → cell text
    const cellMap = new Map<string, string>();
    if (cellColIdx != null) {
      buildCellMap(entries, cellColIdx, keys, uuidItems, cellMap);
    }

    // Assemble rows
    const rows: string[][] = [];
    for (const rowUuid of rowUuids) {
      const row: string[] = [];
      for (const colUuid of colUuids) {
        row.push(cellMap.get(`${colUuid}:${rowUuid}`) ?? "");
      }
      rows.push(row);
    }

    return { rows };
  } catch {
    return null;
  }
}

function uuidBytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Extract ordered UUID hex strings from an OrderedSet.
// The ordering.array.attachment gives the display order with internal UUIDs.
// The ordering.contents dictionary maps internal UUIDs → external UUIDs
// (the ones used as keys in cellColumns). If no contents mapping exists,
// the internal UUIDs are used directly (simple/test case).
function extractOrderedSetUuids(
  entry: Record<string, unknown> | undefined,
  entries: Record<string, unknown>[],
  keys: string[],
  uuidItems: Uint8Array[],
): string[] {
  if (!entry) return [];
  const orderedSet = entry.orderedSet as Record<string, unknown> | undefined;
  if (!orderedSet) return [];
  const ordering = orderedSet.ordering as Record<string, unknown> | undefined;
  if (!ordering) return [];
  const array = ordering.array as Record<string, unknown> | undefined;
  if (!array) return [];
  const attachments = (array.attachment as Record<string, unknown>[]) || [];

  // Get internal UUIDs from attachment bytes
  const internalUuids = attachments.map((a) => {
    const uuid = a.uuid as Uint8Array | undefined;
    return uuid ? uuidBytesToHex(uuid) : "";
  });

  // Build mapping from ordering.contents: internal UUID hex → external UUID hex
  const contentsDict = ordering.contents as Record<string, unknown> | undefined;
  if (!contentsDict) return internalUuids;

  const contentsElements =
    (contentsDict.element as Record<string, unknown>[]) || [];
  const internalToExternal = new Map<string, string>();

  for (const elem of contentsElements) {
    const keyObj = elem.key as Record<string, unknown> | undefined;
    const valObj = elem.value as Record<string, unknown> | undefined;
    if (!keyObj || !valObj) continue;

    const internalHex = resolveObjectIdToUuidHex(
      keyObj,
      entries,
      keys,
      uuidItems,
    );
    const externalHex = resolveObjectIdToUuidHex(
      valObj,
      entries,
      keys,
      uuidItems,
    );
    if (internalHex && externalHex) {
      internalToExternal.set(internalHex, externalHex);
    }
  }

  if (internalToExternal.size === 0) return internalUuids;

  // Map internal → external, falling back to internal if no mapping exists
  return internalUuids.map((uuid) => internalToExternal.get(uuid) ?? uuid);
}

// Resolve an ObjectID to a UUID hex string.
// Dictionary keys can be either:
//   - unsignedIntegerValue: direct index into uuid_item
//   - objectIndex: points to an NSUUID wrapper entry with a UUIDIndex map value
function resolveObjectIdToUuidHex(
  objId: Record<string, unknown>,
  entries: Record<string, unknown>[],
  keys: string[],
  uuidItems: Uint8Array[],
): string | null {
  // Direct uuid_item index
  const directIdx = objId.unsignedIntegerValue as number | undefined;
  if (directIdx != null && uuidItems[directIdx]) {
    return uuidBytesToHex(uuidItems[directIdx]);
  }

  // Indirect: objectIndex → NSUUID entry → UUIDIndex → uuid_item
  const entryIdx = objId.objectIndex as number | undefined;
  if (entryIdx == null) return null;
  const entry = entries[entryIdx];
  if (!entry) return null;

  const cm = entry.customMap as Record<string, unknown> | undefined;
  if (!cm) return null;
  const mes = (cm.mapEntry as Record<string, unknown>[]) || [];
  for (const me of mes) {
    const keyIdx = me.key as number | undefined;
    if (keyIdx == null) continue;
    if (keys[keyIdx] === "UUIDIndex") {
      const val = me.value as Record<string, unknown> | undefined;
      const uuidIdx = val?.unsignedIntegerValue as number | undefined;
      if (uuidIdx != null && uuidItems[uuidIdx]) {
        return uuidBytesToHex(uuidItems[uuidIdx]);
      }
    }
  }
  return null;
}

// Navigate cellColumns: Dictionary { col UUID → Dictionary { row UUID → Note } }
function buildCellMap(
  entries: Record<string, unknown>[],
  cellColIdx: number,
  keys: string[],
  uuidItems: Uint8Array[],
  cellMap: Map<string, string>,
): void {
  const cellColEntry = entries[cellColIdx];
  if (!cellColEntry) return;

  const dict = cellColEntry.dictionary as Record<string, unknown> | undefined;
  if (!dict) return;

  for (const elem of (dict.element as Record<string, unknown>[]) || []) {
    const colKey = elem.key as Record<string, unknown> | undefined;
    const colValue = elem.value as Record<string, unknown> | undefined;
    if (!colKey || !colValue) continue;

    const colUuid = resolveObjectIdToUuidHex(colKey, entries, keys, uuidItems);
    const colObjIdx = colValue.objectIndex as number | undefined;
    if (!colUuid || colObjIdx == null) continue;

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

      const rowUuid = resolveObjectIdToUuidHex(
        rowKey,
        entries,
        keys,
        uuidItems,
      );
      const cellObjIdx = rowValue.objectIndex as number | undefined;
      if (!rowUuid || cellObjIdx == null) continue;

      const cellEntry = entries[cellObjIdx];
      if (!cellEntry) continue;

      const cellNote = cellEntry.note as Record<string, unknown> | undefined;
      if (!cellNote) continue;

      const noteText = (cellNote.noteText as string) || "";
      cellMap.set(`${colUuid}:${rowUuid}`, noteText.replace(/\n$/, ""));
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
