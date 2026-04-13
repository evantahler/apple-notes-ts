import { describe, expect, test } from "bun:test";
import { noteToMarkdown } from "../src/conversion/proto-to-markdown.ts";
import type {
  DecodedAttributeRun,
  DecodedNote,
} from "../src/protobuf/decode.ts";

function note(text: string, runs: DecodedAttributeRun[]): DecodedNote {
  return { text, attributeRuns: runs };
}

describe("noteToMarkdown", () => {
  test("returns empty string for empty note", () => {
    expect(noteToMarkdown({ text: "", attributeRuns: [] })).toBe("");
  });

  test("renders plain text", () => {
    const md = noteToMarkdown(note("Hello world\n", [{ length: 12 }]));
    expect(md).toBe("Hello world");
  });

  test("renders title as h1", () => {
    const md = noteToMarkdown(
      note("My Title\nBody text\n", [
        { length: 9, paragraphStyle: { styleType: 0 } },
        { length: 10 },
      ]),
    );
    expect(md).toBe("# My Title\nBody text");
  });

  test("renders heading as h2", () => {
    const md = noteToMarkdown(
      note("Title\nSection\nBody\n", [
        { length: 6, paragraphStyle: { styleType: 0 } },
        { length: 8, paragraphStyle: { styleType: 1 } },
        { length: 5 },
      ]),
    );
    expect(md).toBe("# Title\n## Section\nBody");
  });

  test("renders subheading as h3", () => {
    const md = noteToMarkdown(
      note("Title\nSub\nBody\n", [
        { length: 6, paragraphStyle: { styleType: 0 } },
        { length: 4, paragraphStyle: { styleType: 2 } },
        { length: 5 },
      ]),
    );
    expect(md).toBe("# Title\n### Sub\nBody");
  });

  test("renders bold text", () => {
    const md = noteToMarkdown(
      note("Hello bold world\n", [
        { length: 6 },
        { length: 4, fontWeight: 1 },
        { length: 7 },
      ]),
    );
    expect(md).toBe("Hello **bold** world");
  });

  test("renders italic text", () => {
    const md = noteToMarkdown(
      note("Hello italic world\n", [
        { length: 6 },
        { length: 6, fontWeight: 2 },
        { length: 7 },
      ]),
    );
    expect(md).toBe("Hello *italic* world");
  });

  test("renders bold+italic text", () => {
    const md = noteToMarkdown(
      note("Hello both world\n", [
        { length: 6 },
        { length: 4, fontWeight: 3 },
        { length: 7 },
      ]),
    );
    expect(md).toBe("Hello ***both*** world");
  });

  test("renders strikethrough text", () => {
    const md = noteToMarkdown(
      note("Hello removed world\n", [
        { length: 6 },
        { length: 7, strikethrough: 1 },
        { length: 7 },
      ]),
    );
    expect(md).toBe("Hello ~~removed~~ world");
  });

  test("renders underline as HTML", () => {
    const md = noteToMarkdown(
      note("Hello underline world\n", [
        { length: 6 },
        { length: 9, underlined: 1 },
        { length: 7 },
      ]),
    );
    expect(md).toBe("Hello <u>underline</u> world");
  });

  test("renders links", () => {
    const md = noteToMarkdown(
      note("Click here for info\n", [
        { length: 6 },
        { length: 4, link: "https://example.com" },
        { length: 10 },
      ]),
    );
    expect(md).toBe("Click [here](https://example.com) for info");
  });

  test("renders inline code", () => {
    const md = noteToMarkdown(
      note("Use console.log in code\n", [
        { length: 4 },
        { length: 11, font: { fontHints: 1 } },
        { length: 9 },
      ]),
    );
    expect(md).toBe("Use `console.log` in code");
  });

  test("renders bullet list", () => {
    const md = noteToMarkdown(
      note("First\nSecond\n", [
        { length: 6, paragraphStyle: { styleType: 100 } },
        { length: 7, paragraphStyle: { styleType: 100 } },
      ]),
    );
    expect(md).toBe("- First\n- Second");
  });

  test("renders dashed list as bullets", () => {
    const md = noteToMarkdown(
      note("First\nSecond\n", [
        { length: 6, paragraphStyle: { styleType: 101 } },
        { length: 7, paragraphStyle: { styleType: 101 } },
      ]),
    );
    expect(md).toBe("- First\n- Second");
  });

  test("renders numbered list", () => {
    const md = noteToMarkdown(
      note("First\nSecond\n", [
        { length: 6, paragraphStyle: { styleType: 102 } },
        { length: 7, paragraphStyle: { styleType: 102 } },
      ]),
    );
    expect(md).toBe("1. First\n1. Second");
  });

  test("renders nested lists with indent", () => {
    const md = noteToMarkdown(
      note("Top\nNested\nDeep\n", [
        { length: 4, paragraphStyle: { styleType: 100 } },
        { length: 7, paragraphStyle: { styleType: 100, indentAmount: 1 } },
        { length: 5, paragraphStyle: { styleType: 100, indentAmount: 2 } },
      ]),
    );
    expect(md).toBe("- Top\n  - Nested\n    - Deep");
  });

  test("renders unchecked checklist item", () => {
    const md = noteToMarkdown(
      note("Todo item\n", [
        {
          length: 10,
          paragraphStyle: {
            styleType: 103,
            checklist: { uuid: new Uint8Array(16), done: 0 },
          },
        },
      ]),
    );
    expect(md).toBe("- [ ] Todo item");
  });

  test("renders checked checklist item", () => {
    const md = noteToMarkdown(
      note("Done item\n", [
        {
          length: 10,
          paragraphStyle: {
            styleType: 103,
            checklist: { uuid: new Uint8Array(16), done: 1 },
          },
        },
      ]),
    );
    expect(md).toBe("- [x] Done item");
  });

  test("renders code block (consecutive monospaced lines)", () => {
    const md = noteToMarkdown(
      note("Before\nline 1\nline 2\nAfter\n", [
        { length: 7 },
        { length: 7, paragraphStyle: { styleType: 4 } },
        { length: 7, paragraphStyle: { styleType: 4 } },
        { length: 6 },
      ]),
    );
    expect(md).toBe("Before\n```\nline 1\nline 2\n```\nAfter");
  });

  test("renders block quote", () => {
    const md = noteToMarkdown(
      note("Before\nQuoted text\nAfter\n", [
        { length: 7 },
        { length: 12, paragraphStyle: { blockQuote: 1 } },
        { length: 6 },
      ]),
    );
    expect(md).toBe("Before\n> Quoted text\nAfter");
  });

  test("renders attachment placeholder", () => {
    const md = noteToMarkdown(
      note("Before\n\uFFFC\nAfter\n", [
        { length: 7 },
        {
          length: 1,
          attachmentInfo: {
            attachmentIdentifier: "UUID-123",
            typeUti: "public.jpeg",
          },
        },
        { length: 1 },
        { length: 6 },
      ]),
    );
    expect(md).toContain("![attachment](attachment:UUID-123?type=public.jpeg)");
  });

  test("renders mixed formatting in one note", () => {
    const md = noteToMarkdown(
      note("Title\nHello bold and italic world\n", [
        { length: 6, paragraphStyle: { styleType: 0 } },
        { length: 6 },
        { length: 4, fontWeight: 1 },
        { length: 5 },
        { length: 6, fontWeight: 2 },
        { length: 7 },
      ]),
    );
    expect(md).toBe("# Title\nHello **bold** and *italic* world");
  });

  test("strips trailing empty lines", () => {
    const md = noteToMarkdown(
      note("Hello\n\n\n", [{ length: 6 }, { length: 1 }, { length: 1 }]),
    );
    expect(md).toBe("Hello");
  });
});
