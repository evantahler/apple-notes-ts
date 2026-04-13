import type { DecodedAttributeRun, DecodedNote } from "../protobuf/decode.ts";

// ParagraphStyle.style_type values (from notestore.proto)
const STYLE_TITLE = 0;
const STYLE_HEADING = 1;
const STYLE_SUBHEADING = 2;
const STYLE_MONOSPACED = 4;
const STYLE_DOTTED_LIST = 100; // bullet (dotted)
const STYLE_DASHED_LIST = 101; // bullet (dashed)
const STYLE_NUMBERED_LIST = 102;
const STYLE_CHECKLIST = 103;

// font_weight values
const FONT_WEIGHT_BOLD = 1;
const FONT_WEIGHT_ITALIC = 2;
const FONT_WEIGHT_BOLD_ITALIC = 3;

export function noteToMarkdown(note: DecodedNote): string {
  if (!note.text) return "";

  const { text, attributeRuns } = note;
  const lines = splitIntoLines(text, attributeRuns);
  const mdLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const isCode = line.paragraphStyle?.styleType === STYLE_MONOSPACED;

    if (isCode && !inCodeBlock) {
      mdLines.push("```");
      inCodeBlock = true;
    } else if (!isCode && inCodeBlock) {
      mdLines.push("```");
      inCodeBlock = false;
    }

    if (isCode) {
      mdLines.push(line.text);
    } else {
      mdLines.push(renderLine(line));
    }
  }

  if (inCodeBlock) {
    mdLines.push("```");
  }

  // Remove the trailing newline that Apple Notes always includes
  while (mdLines.length > 0 && mdLines[mdLines.length - 1] === "") {
    mdLines.pop();
  }

  return mdLines.join("\n");
}

interface LineParts {
  text: string;
  runs: DecodedAttributeRun[];
  paragraphStyle?: DecodedAttributeRun["paragraphStyle"];
}

function splitIntoLines(
  text: string,
  attributeRuns: DecodedAttributeRun[],
): LineParts[] {
  const lines: LineParts[] = [];
  let pos = 0;
  let lineStart = 0;
  let lineRuns: DecodedAttributeRun[] = [];
  let lineParagraphStyle: DecodedAttributeRun["paragraphStyle"] | undefined;

  for (const run of attributeRuns) {
    if (run.paragraphStyle) {
      lineParagraphStyle = run.paragraphStyle;
    }

    const runEnd = pos + run.length;
    let scanPos = pos;

    while (scanPos < runEnd) {
      const newlineIdx = text.indexOf("\n", scanPos);

      if (newlineIdx >= 0 && newlineIdx < runEnd) {
        // This run contains a newline - split it
        const beforeLen = newlineIdx - pos;
        if (beforeLen > 0) {
          lineRuns.push({ ...run, length: beforeLen });
        }

        lines.push({
          text: text.slice(lineStart, newlineIdx),
          runs: lineRuns,
          paragraphStyle: lineParagraphStyle,
        });

        lineStart = newlineIdx + 1;
        scanPos = newlineIdx + 1;
        pos = scanPos;
        lineRuns = [];
        lineParagraphStyle = undefined;
      } else {
        // No more newlines in this run
        const remainLen = runEnd - pos;
        if (remainLen > 0) {
          lineRuns.push({ ...run, length: remainLen });
        }
        scanPos = runEnd;
      }
    }

    pos = runEnd;
  }

  // Handle final line (no trailing newline)
  if (lineStart < text.length) {
    lines.push({
      text: text.slice(lineStart),
      runs: lineRuns,
      paragraphStyle: lineParagraphStyle,
    });
  }

  return lines;
}

function renderLine(line: LineParts): string {
  const style = line.paragraphStyle;
  const styleType = style?.styleType;
  const indent = style?.indentAmount ?? 0;
  const indentStr = "  ".repeat(indent);
  const inlineText = renderInlineFormatting(line.text, line.runs);

  // Title (first line of note) → # heading
  if (styleType === STYLE_TITLE) {
    return `# ${inlineText}`;
  }

  // Heading → ##
  if (styleType === STYLE_HEADING) {
    return `## ${inlineText}`;
  }

  // Subheading → ###
  if (styleType === STYLE_SUBHEADING) {
    return `### ${inlineText}`;
  }

  // Bullet list (dotted or dashed)
  if (styleType === STYLE_DOTTED_LIST || styleType === STYLE_DASHED_LIST) {
    return `${indentStr}- ${inlineText}`;
  }

  // Numbered list
  if (styleType === STYLE_NUMBERED_LIST) {
    return `${indentStr}1. ${inlineText}`;
  }

  // Checklist
  if (styleType === STYLE_CHECKLIST) {
    const done = style?.checklist?.done === 1;
    return `${indentStr}- [${done ? "x" : " "}] ${inlineText}`;
  }

  // Block quote
  if (style?.blockQuote === 1) {
    return `> ${inlineText}`;
  }

  return inlineText;
}

function renderInlineFormatting(
  text: string,
  runs: DecodedAttributeRun[],
): string {
  if (runs.length === 0) return text;

  let result = "";
  let pos = 0;

  for (const run of runs) {
    const segment = text.slice(pos, pos + run.length);
    pos += run.length;

    if (!segment) continue;

    // Attachment placeholder
    if (run.attachmentInfo?.attachmentIdentifier) {
      const id = run.attachmentInfo.attachmentIdentifier;
      const uti = run.attachmentInfo.typeUti ?? "unknown";
      result += `![attachment](attachment:${id}?type=${uti})`;
      continue;
    }

    let formatted = segment;

    // Code (monospace font hint)
    if (run.font?.fontHints === 1) {
      formatted = `\`${formatted}\``;
    } else {
      // font_weight: 1=bold, 2=italic, 3=bold+italic
      const fw = run.fontWeight ?? 0;
      const isBold = fw === FONT_WEIGHT_BOLD || fw === FONT_WEIGHT_BOLD_ITALIC;
      const isItalic =
        fw === FONT_WEIGHT_ITALIC || fw === FONT_WEIGHT_BOLD_ITALIC;

      if (isBold && isItalic) {
        formatted = `***${formatted}***`;
      } else if (isBold) {
        formatted = `**${formatted}**`;
      } else if (isItalic) {
        formatted = `*${formatted}*`;
      }

      // Strikethrough
      if (run.strikethrough != null && run.strikethrough > 0) {
        formatted = `~~${formatted}~~`;
      }

      // Underline (markdown doesn't have native underline, use HTML)
      if (run.underlined != null && run.underlined > 0) {
        formatted = `<u>${formatted}</u>`;
      }
    }

    // Link
    if (run.link) {
      formatted = `[${formatted}](${run.link})`;
    }

    result += formatted;
  }

  return result;
}
