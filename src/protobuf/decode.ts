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
