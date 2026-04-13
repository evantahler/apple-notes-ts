/**
 * Interactive TUI for browsing Apple Notes.
 *
 * Requires Full Disk Access for the terminal running this script.
 * Run with: bun tui
 */

import type { AttachmentRef, Folder, NoteMeta } from "./src/index.ts";
import {
  AppleNotes,
  DatabaseAccessDeniedError,
  PasswordProtectedError,
} from "./src/index.ts";

// ── Terminal helpers ─────────────────────────────────────────────────────────

const ESC = "\x1b";
const CSI = `${ESC}[`;

const term = {
  altScreenOn: `${CSI}?1049h`,
  altScreenOff: `${CSI}?1049l`,
  cursorHide: `${CSI}?25l`,
  cursorShow: `${CSI}?25h`,
  clear: `${CSI}2J`,
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  inverse: `${CSI}7m`,
  fg: {
    red: `${CSI}31m`,
    green: `${CSI}32m`,
    yellow: `${CSI}33m`,
    blue: `${CSI}34m`,
    cyan: `${CSI}36m`,
    gray: `${CSI}90m`,
  },
};

function moveTo(row: number, col: number): string {
  return `${CSI}${row + 1};${col + 1}H`;
}

/** Wrap text as a clickable OSC 8 hyperlink. */
function hyperlink(url: string, text: string): string {
  return `${ESC}]8;;${url}\x07${text}${ESC}]8;;\x07`;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences and OSC 8 hyperlinks
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

function truncate(s: string, max: number): string {
  let visible = 0;
  let result = "";
  let i = 0;
  while (i < s.length) {
    // Skip CSI sequences (e.g. \x1b[1m)
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      const end = s.indexOf("m", i);
      if (end !== -1) {
        result += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    // Skip OSC 8 hyperlink sequences (e.g. \x1b]8;;url\x07)
    if (s[i] === "\x1b" && s[i + 1] === "]") {
      const end = s.indexOf("\x07", i);
      if (end !== -1) {
        result += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (visible >= max) break;
    result += s[i];
    visible++;
    i++;
  }
  return result + term.reset;
}

function pad(s: string, width: number): string {
  const vl = visibleLength(s);
  if (vl >= width) return truncate(s, width);
  return s + " ".repeat(width - vl);
}

function write(s: string) {
  process.stdout.write(s);
}

// ── Folder tree ──────────────────────────────────────────────────────────────

interface TreeItem {
  label: string;
  folder: Folder | null; // null = "All Notes" or account header
  isAccount: boolean;
  indent: number;
}

function buildFolderTree(db: AppleNotes): TreeItem[] {
  const items: TreeItem[] = [];
  const folders = db.folders();
  const allNotes = db.notes();

  // "All Notes" entry
  items.push({
    label: `All Notes (${allNotes.length})`,
    folder: null,
    isAccount: false,
    indent: 0,
  });

  // Group folders by account name (more reliable than matching account IDs)
  const grouped = new Map<string, Folder[]>();
  for (const folder of folders) {
    const key = folder.accountName || "Other";
    const list = grouped.get(key) ?? [];
    list.push(folder);
    grouped.set(key, list);
  }

  for (const [accountName, accountFolders] of grouped) {
    items.push({
      label: accountName,
      folder: null,
      isAccount: true,
      indent: 0,
    });

    for (const folder of accountFolders) {
      items.push({
        label: `${folder.name} (${folder.noteCount})`,
        folder,
        isAccount: false,
        indent: 1,
      });
    }
  }

  return items;
}

// ── State ────────────────────────────────────────────────────────────────────

type Panel = "folders" | "notes" | "content";

interface State {
  focus: Panel;
  tree: TreeItem[];
  treeIndex: number;
  treeScroll: number;
  notes: NoteMeta[];
  allNotes: NoteMeta[];
  noteIndex: number;
  noteScroll: number;
  contentLines: string[];
  contentScroll: number;
  rawMarkdown: string;
  attachments: AttachmentRef[];
  searchMode: boolean;
  searchQuery: string;
  statusMessage: string;
}

let db: AppleNotes;
const state: State = {
  focus: "folders",
  tree: [],
  treeIndex: 0,
  treeScroll: 0,
  notes: [],
  allNotes: [],
  noteIndex: 0,
  noteScroll: 0,
  contentLines: [],
  contentScroll: 0,
  rawMarkdown: "",
  attachments: [],
  searchMode: false,
  searchQuery: "",
  statusMessage: "",
};

// ── Layout ───────────────────────────────────────────────────────────────────

function totalCols(): number {
  return process.stdout.columns || 80;
}
function totalRows(): number {
  return process.stdout.rows || 24;
}

function folderPanelWidth(): number {
  return Math.max(20, Math.min(35, Math.floor(totalCols() * 0.2)));
}
function notePanelWidth(): number {
  return Math.max(25, Math.min(45, Math.floor(totalCols() * 0.25)));
}
function contentPanelWidth(): number {
  return totalCols() - folderPanelWidth() - notePanelWidth() - 2; // 2 dividers
}
function bodyRows(): number {
  return totalRows() - 2; // header + footer
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(markdown: string, width: number): string[] {
  const rendered = Bun.markdown.ansi(markdown, {
    columns: Math.max(width - 2, 20),
    hyperlinks: true,
  });
  return rendered.split("\n");
}

// ── Actions ──────────────────────────────────────────────────────────────────

function loadNotesForFolder() {
  const item = state.tree[state.treeIndex];
  if (!item || item.isAccount) return;

  if (item.folder === null) {
    // "All Notes"
    state.notes = state.allNotes;
  } else {
    state.notes = state.allNotes.filter((n) => n.folderId === item.folder?.id);
  }
  state.noteIndex = 0;
  state.noteScroll = 0;
  state.statusMessage = "";
  loadSelectedNote();
}

function loadSelectedNote() {
  const note = state.notes[state.noteIndex];
  if (!note) {
    state.contentLines = [];
    state.contentScroll = 0;
    return;
  }
  state.contentScroll = 0;
  state.attachments = [];
  state.rawMarkdown = "";
  try {
    const content = db.read(note.id);
    state.rawMarkdown = content.markdown;
    state.contentLines = renderMarkdown(content.markdown, contentPanelWidth());

    // Collect attachments from the DB query
    state.attachments = db.listAttachments(note.id);

    // Also extract attachment IDs from the markdown (protobuf embeds them as
    // ![attachment](attachment:UUID?type=UTI)) — the DB query may miss some
    const inlineRe = /!\[.*?\]\(attachment:([^?)]+)/g;
    const seenIds = new Set(state.attachments.map((a) => String(a.id)));
    for (const match of content.markdown.matchAll(inlineRe)) {
      const id = match[1] as string;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const url = db.getAttachmentUrl(id);
      state.attachments.push({
        id: 0,
        identifier: id,
        name: id,
        contentType: "",
        url,
      });
    }

    if (state.attachments.length > 0) {
      state.contentLines.push(
        "",
        `${term.dim}── Attachments (${state.attachments.length}) — press ${term.reset}o${term.dim} to open ──${term.reset}`,
      );
      for (const a of state.attachments) {
        const label = a.name || a.id;
        const path = a.url
          ? hyperlink(
              a.url,
              `${term.fg.cyan}${term.underline}${a.url}${term.reset}`,
            )
          : `${term.dim}(unresolved)${term.reset}`;
        state.contentLines.push(
          `  ${label} ${a.contentType ? `${term.dim}(${a.contentType})${term.reset} ` : ""}`,
          `    ${path}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof PasswordProtectedError) {
      state.contentLines = [
        "",
        `  ${term.dim}This note is password protected.${term.reset}`,
      ];
    } else {
      state.contentLines = [
        "",
        `  ${term.fg.red}Error reading note: ${err}${term.reset}`,
      ];
    }
  }
}

function selectTreeItem(index: number) {
  const br = bodyRows();
  const prev = state.treeIndex;
  const dir = index >= prev ? 1 : -1;
  state.treeIndex = Math.max(0, Math.min(index, state.tree.length - 1));

  // Skip account headers — keep moving in the same direction
  while (
    state.tree[state.treeIndex]?.isAccount &&
    state.treeIndex + dir >= 0 &&
    state.treeIndex + dir < state.tree.length
  ) {
    state.treeIndex += dir;
  }
  // If we landed on a header at the boundary, reverse
  if (state.tree[state.treeIndex]?.isAccount) {
    state.treeIndex = prev;
  }

  if (state.treeIndex < state.treeScroll) {
    state.treeScroll = state.treeIndex;
  } else if (state.treeIndex >= state.treeScroll + br) {
    state.treeScroll = state.treeIndex - br + 1;
  }

  loadNotesForFolder();
}

function selectNote(index: number) {
  const br = bodyRows();
  state.noteIndex = Math.max(0, Math.min(index, state.notes.length - 1));

  if (state.noteIndex < state.noteScroll) {
    state.noteScroll = state.noteIndex;
  } else if (state.noteIndex >= state.noteScroll + br) {
    state.noteScroll = state.noteIndex - br + 1;
  }

  loadSelectedNote();
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function draw() {
  const tc = totalCols();
  const tr = totalRows();
  const fw = folderPanelWidth();
  const nw = notePanelWidth();
  const cw = contentPanelWidth();
  const br = bodyRows();

  let buf = term.clear + moveTo(0, 0);

  // Header bar
  const title = " Apple Notes ";
  const folderLabel =
    state.focus === "folders"
      ? `${term.underline}Folders${term.reset}${term.inverse}${term.bold}`
      : "Folders";
  const noteLabel =
    state.focus === "notes"
      ? `${term.underline}Notes${term.reset}${term.inverse}${term.bold}`
      : "Notes";
  const contentLabel =
    state.focus === "content"
      ? `${term.underline}Content${term.reset}${term.inverse}${term.bold}`
      : "Content";
  const headerText = `${title} ${term.dim}│${term.reset}${term.inverse}${term.bold} ${folderLabel} → ${noteLabel} → ${contentLabel} `;
  const headerVis = visibleLength(headerText);
  buf += `${term.inverse}${term.bold}${headerText}${" ".repeat(Math.max(0, tc - headerVis))}${term.reset}`;

  // Body rows
  for (let row = 0; row < br; row++) {
    buf += moveTo(row + 1, 0);

    // Folder panel
    const treeIdx = row + state.treeScroll;
    if (treeIdx < state.tree.length) {
      const item = state.tree[treeIdx] as TreeItem;
      const isSelected = treeIdx === state.treeIndex;
      const isFocused = state.focus === "folders";

      let line: string;
      if (item.isAccount) {
        line = `${term.bold}${term.fg.yellow} ${item.label}${term.reset}`;
      } else {
        const indent = "  ".repeat(item.indent);
        const icon = item.folder === null ? "◆" : "▸";
        line = `${indent} ${icon} ${item.label}`;
      }

      if (isSelected && isFocused) {
        buf += `${term.inverse}${term.bold}${pad(line, fw)}${term.reset}`;
      } else if (isSelected) {
        buf += `${term.bold}${pad(line, fw)}${term.reset}`;
      } else {
        buf += pad(line, fw);
      }
    } else {
      buf += " ".repeat(fw);
    }

    // Divider
    buf += `${term.dim}│${term.reset}`;

    // Note list panel
    const noteIdx = row + state.noteScroll;
    if (noteIdx < state.notes.length) {
      const note = state.notes[noteIdx] as NoteMeta;
      const isSelected = noteIdx === state.noteIndex;
      const isFocused = state.focus === "notes";

      const date = note.modifiedAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const datePart = `${term.dim}${date}${term.reset}`;
      const dateVis = date.length;
      const titleSpace = nw - dateVis - 3;
      const t = truncate(note.title, Math.max(5, titleSpace));
      const gap = nw - visibleLength(t) - dateVis - 2;
      const line = ` ${t}${" ".repeat(Math.max(1, gap))}${datePart}`;

      if (isSelected && isFocused) {
        buf += `${term.inverse}${term.bold}${pad(line, nw)}${term.reset}`;
      } else if (isSelected) {
        buf += `${term.bold}${pad(line, nw)}${term.reset}`;
      } else {
        buf += pad(line, nw);
      }
    } else {
      buf += " ".repeat(nw);
    }

    // Divider
    buf += `${term.dim}│${term.reset}`;

    // Content panel
    const contentIdx = row + state.contentScroll;
    if (contentIdx >= 0 && contentIdx < state.contentLines.length) {
      const line = state.contentLines[contentIdx] as string;
      buf += ` ${truncate(line, cw - 1)}`;
    }
  }

  // Footer bar
  buf += moveTo(tr - 1, 0);
  let footer: string;
  if (state.searchMode) {
    footer = ` /${state.searchQuery}█  ${term.dim}Enter=search  Esc=cancel${term.reset}`;
  } else if (state.statusMessage) {
    footer = ` ${state.statusMessage}`;
  } else {
    footer = ` ${term.dim}←→${term.reset} panels  ${term.dim}↑↓${term.reset} navigate  ${term.dim}j/k${term.reset} scroll  ${term.dim}o${term.reset} open attachments  ${term.dim}/${term.reset} search  ${term.dim}q${term.reset} quit`;
  }
  buf += `${term.inverse}${pad(footer, tc)}${term.reset}`;

  write(buf);
}

// ── Input handling ───────────────────────────────────────────────────────────

function doSearch() {
  const query = state.searchQuery.trim();
  state.searchMode = false;
  if (!query) {
    loadNotesForFolder();
    state.statusMessage = "";
    return;
  }
  state.notes = db.search(query);
  state.statusMessage = `${state.notes.length} result${state.notes.length === 1 ? "" : "s"} for "${query}"`;
  state.noteIndex = 0;
  state.noteScroll = 0;
  loadSelectedNote();
}

function clearSearch() {
  state.searchMode = false;
  state.searchQuery = "";
  state.statusMessage = "";
  loadNotesForFolder();
}

function cleanup() {
  write(term.altScreenOff + term.cursorShow);
  process.stdin.setRawMode(false);
  db.close();
}

function handleInput(data: Buffer) {
  const s = data.toString("utf-8");

  if (s === "\x03") {
    cleanup();
    process.exit(0);
  }

  if (state.searchMode) {
    if (s === "\x1b") {
      clearSearch();
    } else if (s === "\r" || s === "\n") {
      doSearch();
    } else if (s === "\x7f" || s === "\b") {
      state.searchQuery = state.searchQuery.slice(0, -1);
    } else if (s.length === 1 && s >= " ") {
      state.searchQuery += s;
    }
    draw();
    return;
  }

  const maxContentScroll = Math.max(0, state.contentLines.length - bodyRows());

  switch (s) {
    case "q":
      cleanup();
      process.exit(0);
      break;

    // Left/right — switch panels
    case "\x1b[D": // Left arrow
      if (state.focus === "content") state.focus = "notes";
      else if (state.focus === "notes") state.focus = "folders";
      break;
    case "\x1b[C": // Right arrow
      if (state.focus === "folders") state.focus = "notes";
      else if (state.focus === "notes") state.focus = "content";
      break;

    // Up/down — navigate within focused panel
    case "\x1b[A": // Up
      if (state.focus === "folders") selectTreeItem(state.treeIndex - 1);
      else if (state.focus === "notes") selectNote(state.noteIndex - 1);
      else state.contentScroll = Math.max(0, state.contentScroll - 1);
      break;
    case "\x1b[B": // Down
      if (state.focus === "folders") selectTreeItem(state.treeIndex + 1);
      else if (state.focus === "notes") selectNote(state.noteIndex + 1);
      else
        state.contentScroll = Math.min(
          maxContentScroll,
          state.contentScroll + 1,
        );
      break;
    case "\x1b[5~": // Page Up
      if (state.focus === "folders")
        selectTreeItem(state.treeIndex - bodyRows());
      else if (state.focus === "notes")
        selectNote(state.noteIndex - bodyRows());
      else state.contentScroll = Math.max(0, state.contentScroll - bodyRows());
      break;
    case "\x1b[6~": // Page Down
      if (state.focus === "folders")
        selectTreeItem(state.treeIndex + bodyRows());
      else if (state.focus === "notes")
        selectNote(state.noteIndex + bodyRows());
      else
        state.contentScroll = Math.min(
          maxContentScroll,
          state.contentScroll + bodyRows(),
        );
      break;

    // j/k — always scroll content
    case "k":
      state.contentScroll = Math.max(0, state.contentScroll - 1);
      break;
    case "K":
      state.contentScroll = Math.max(0, state.contentScroll - bodyRows());
      break;
    case "j":
      state.contentScroll = Math.min(maxContentScroll, state.contentScroll + 1);
      break;
    case "J":
      state.contentScroll = Math.min(
        maxContentScroll,
        state.contentScroll + bodyRows(),
      );
      break;

    case "o": {
      // Resolve attachment URLs from stored attachments + raw markdown
      const urls: string[] = [];
      for (const a of state.attachments) {
        if (a.url) urls.push(a.url);
      }
      // Also try extracting from raw markdown in case state.attachments missed some
      if (state.rawMarkdown) {
        const inlineRe = /!\[.*?\]\(attachment:([^?)]+)/g;
        for (const match of state.rawMarkdown.matchAll(inlineRe)) {
          const id = match[1] as string;
          const url = db.getAttachmentUrl(id);
          if (url && !urls.includes(url)) urls.push(url);
        }
      }
      if (urls.length > 0) {
        for (const url of urls) Bun.spawn(["open", url]);
        state.statusMessage = `Opened ${urls.length} attachment${urls.length === 1 ? "" : "s"}`;
      } else {
        state.statusMessage = "No attachments to open";
      }
      break;
    }

    case "/":
      state.searchMode = true;
      state.searchQuery = "";
      break;
    case "\x1b":
      if (state.statusMessage) clearSearch();
      break;
  }

  draw();
}

// ── Main ─────────────────────────────────────────────────────────────────────

try {
  db = new AppleNotes();
} catch (error) {
  if (error instanceof DatabaseAccessDeniedError) {
    console.error(error.message);
    console.error("\nOpening Full Disk Access settings...");
    error.openSettings();
    process.exit(1);
  }
  throw error;
}

state.allNotes = db.notes();
state.tree = buildFolderTree(db);

if (state.allNotes.length === 0) {
  console.log("No notes found.");
  db.close();
  process.exit(0);
}

// Enter TUI mode
write(term.altScreenOn + term.cursorHide);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", handleInput);
process.stdout.on("resize", draw);

// Select "All Notes" and load
selectTreeItem(0);
draw();
