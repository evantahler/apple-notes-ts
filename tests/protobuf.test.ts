import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import protobuf from "protobufjs";
import { decodeNoteData } from "../src/protobuf/decode.ts";

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
