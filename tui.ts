/**
 * Interactive TUI for browsing Apple Notes and Messages.
 *
 * Requires Full Disk Access for the terminal running this script.
 * Run with: bun tui
 */

import type { AttachmentRef, Folder, NoteMeta } from "./src/index.ts";
import {
  DatabaseAccessDeniedError,
  Notes,
  PasswordProtectedError,
} from "./src/index.ts";
import type { Chat, MessageMeta } from "./src/messages/index.ts";
import { Messages } from "./src/messages/index.ts";

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
    magenta: `${CSI}35m`,
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

// ── Folder tree (Notes) ─────────────────────────────────────────────────────

interface TreeItem {
  label: string;
  folder: Folder | null;
  isAccount: boolean;
  indent: number;
}

function buildFolderTree(notesDb: Notes): TreeItem[] {
  const items: TreeItem[] = [];
  const folders = notesDb.folders();
  const allNotes = notesDb.notes();

  items.push({
    label: `All Notes (${allNotes.length})`,
    folder: null,
    isAccount: false,
    indent: 0,
  });

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

type Tab = "notes" | "messages";
type NotesPanel = "folders" | "notes" | "content";
type MessagesPanel = "chats" | "messages";

interface NotesState {
  focus: NotesPanel;
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
}

interface MessagesState {
  focus: MessagesPanel;
  chats: Chat[];
  chatIndex: number;
  chatScroll: number;
  messages: MessageMeta[];
  messageScroll: number;
}

interface AppState {
  tab: Tab;
  searchMode: boolean;
  searchQuery: string;
  statusMessage: string;
  notesState: NotesState;
  messagesState: MessagesState;
}

let notesDb: Notes;
let messagesDb: Messages;

const state: AppState = {
  tab: "notes",
  searchMode: false,
  searchQuery: "",
  statusMessage: "",
  notesState: {
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
  },
  messagesState: {
    focus: "chats",
    chats: [],
    chatIndex: 0,
    chatScroll: 0,
    messages: [],
    messageScroll: 0,
  },
};

// ── Layout ───────────────────────────────────────────────────────────────────

function totalCols(): number {
  return process.stdout.columns || 80;
}
function totalRows(): number {
  return process.stdout.rows || 24;
}

// Notes layout
function folderPanelWidth(): number {
  return Math.max(20, Math.min(35, Math.floor(totalCols() * 0.2)));
}
function notePanelWidth(): number {
  return Math.max(25, Math.min(45, Math.floor(totalCols() * 0.25)));
}
function contentPanelWidth(): number {
  return totalCols() - folderPanelWidth() - notePanelWidth() - 2;
}

// Messages layout
function chatPanelWidth(): number {
  return Math.max(25, Math.min(45, Math.floor(totalCols() * 0.3)));
}
function messagePanelWidth(): number {
  return totalCols() - chatPanelWidth() - 1;
}

function bodyRows(): number {
  return totalRows() - 3; // tab bar + header + footer
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(markdown: string, width: number): string[] {
  const rendered = Bun.markdown.ansi(markdown, {
    columns: Math.max(width - 2, 20),
    hyperlinks: true,
  });
  return rendered.split("\n");
}

// ── Notes Actions ───────────────────────────────────────────────────────────

function loadNotesForFolder() {
  const ns = state.notesState;
  const item = ns.tree[ns.treeIndex];
  if (!item || item.isAccount) return;

  if (item.folder === null) {
    ns.notes = ns.allNotes;
  } else {
    ns.notes = ns.allNotes.filter((n) => n.folderId === item.folder?.id);
  }
  ns.noteIndex = 0;
  ns.noteScroll = 0;
  state.statusMessage = "";
  loadSelectedNote();
}

function loadSelectedNote() {
  const ns = state.notesState;
  const note = ns.notes[ns.noteIndex];
  if (!note) {
    ns.contentLines = [];
    ns.contentScroll = 0;
    return;
  }
  ns.contentScroll = 0;
  ns.attachments = [];
  ns.rawMarkdown = "";
  try {
    const content = notesDb.read(note.id);
    ns.rawMarkdown = content.markdown;
    ns.contentLines = renderMarkdown(content.markdown, contentPanelWidth());

    ns.attachments = notesDb.listAttachments(note.id);

    const inlineRe = /!\[.*?\]\(attachment:([^?)]+)/g;
    const seenIds = new Set(ns.attachments.map((a) => String(a.id)));
    for (const match of content.markdown.matchAll(inlineRe)) {
      const id = match[1] as string;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const url = notesDb.getAttachmentUrl(id);
      ns.attachments.push({
        id: 0,
        identifier: id,
        name: id,
        contentType: "",
        url,
      });
    }

    if (ns.attachments.length > 0) {
      ns.contentLines.push(
        "",
        `${term.dim}── Attachments (${ns.attachments.length}) — press ${term.reset}o${term.dim} to open ──${term.reset}`,
      );
      for (const a of ns.attachments) {
        const label = a.name || a.id;
        const path = a.url
          ? hyperlink(
              a.url,
              `${term.fg.cyan}${term.underline}${a.url}${term.reset}`,
            )
          : `${term.dim}(unresolved)${term.reset}`;
        ns.contentLines.push(
          `  ${label} ${a.contentType ? `${term.dim}(${a.contentType})${term.reset} ` : ""}`,
          `    ${path}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof PasswordProtectedError) {
      ns.contentLines = [
        "",
        `  ${term.dim}This note is password protected.${term.reset}`,
      ];
    } else {
      ns.contentLines = [
        "",
        `  ${term.fg.red}Error reading note: ${err}${term.reset}`,
      ];
    }
  }
}

function selectTreeItem(index: number) {
  const ns = state.notesState;
  const br = bodyRows();
  const prev = ns.treeIndex;
  const dir = index >= prev ? 1 : -1;
  ns.treeIndex = Math.max(0, Math.min(index, ns.tree.length - 1));

  while (
    ns.tree[ns.treeIndex]?.isAccount &&
    ns.treeIndex + dir >= 0 &&
    ns.treeIndex + dir < ns.tree.length
  ) {
    ns.treeIndex += dir;
  }
  if (ns.tree[ns.treeIndex]?.isAccount) {
    ns.treeIndex = prev;
  }

  if (ns.treeIndex < ns.treeScroll) {
    ns.treeScroll = ns.treeIndex;
  } else if (ns.treeIndex >= ns.treeScroll + br) {
    ns.treeScroll = ns.treeIndex - br + 1;
  }

  loadNotesForFolder();
}

function selectNote(index: number) {
  const ns = state.notesState;
  const br = bodyRows();
  ns.noteIndex = Math.max(0, Math.min(index, ns.notes.length - 1));

  if (ns.noteIndex < ns.noteScroll) {
    ns.noteScroll = ns.noteIndex;
  } else if (ns.noteIndex >= ns.noteScroll + br) {
    ns.noteScroll = ns.noteIndex - br + 1;
  }

  loadSelectedNote();
}

// ── Messages Actions ────────────────────────────────────────────────────────

function loadChats() {
  const ms = state.messagesState;
  ms.chats = messagesDb.chats();
  ms.chatIndex = 0;
  ms.chatScroll = 0;
  loadSelectedChat();
}

function loadSelectedChat() {
  const ms = state.messagesState;
  const chat = ms.chats[ms.chatIndex];
  if (!chat) {
    ms.messages = [];
    ms.messageScroll = 0;
    return;
  }
  ms.messageScroll = 0;
  ms.messages = messagesDb.messages(chat.id, { order: "asc" });
  // Auto-scroll to bottom (newest messages)
  const maxScroll = Math.max(0, ms.messages.length - bodyRows());
  ms.messageScroll = maxScroll;
}

function selectChat(index: number) {
  const ms = state.messagesState;
  const br = bodyRows();
  ms.chatIndex = Math.max(0, Math.min(index, ms.chats.length - 1));

  if (ms.chatIndex < ms.chatScroll) {
    ms.chatScroll = ms.chatIndex;
  } else if (ms.chatIndex >= ms.chatScroll + br) {
    ms.chatScroll = ms.chatIndex - br + 1;
  }

  loadSelectedChat();
}

// ── Messages rendering ──────────────────────────────────────────────────────

function formatMessageLine(
  msg: MessageMeta,
  width: number,
): { line1: string; line2: string } {
  const time = msg.date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const date = msg.date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const sender = msg.isFromMe
    ? `${term.fg.blue}You${term.reset}`
    : `${term.fg.green}${msg.senderHandle}${term.reset}`;

  const svcBadge =
    msg.service === "SMS"
      ? `${term.fg.green} SMS${term.reset}`
      : msg.service === "RCS"
        ? `${term.fg.magenta} RCS${term.reset}`
        : "";

  const line1 = ` ${sender}${svcBadge}  ${term.dim}${date} ${time}${term.reset}`;

  let text = msg.text.replace(/\n/g, " ");
  if (msg.isAudioMessage && !text.trim()) text = "🎤 Audio message";
  if (msg.hasAttachments && !text.trim()) text = "📎 Attachment";
  const textWidth = Math.max(10, width - 4);
  const line2 = `   ${truncate(text, textWidth)}`;

  return { line1, line2 };
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function drawTabBar(): string {
  const tc = totalCols();
  const notesTab =
    state.tab === "notes"
      ? `${term.bold}${term.underline} 1 Notes ${term.reset}${term.inverse}`
      : `${term.dim} 1 Notes ${term.reset}${term.inverse}`;
  const msgsTab =
    state.tab === "messages"
      ? `${term.bold}${term.underline} 2 Messages ${term.reset}${term.inverse}`
      : `${term.dim} 2 Messages ${term.reset}${term.inverse}`;

  const tabText = `${notesTab}  ${msgsTab} `;
  const tabVis = visibleLength(tabText);
  return `${term.inverse}${tabText}${" ".repeat(Math.max(0, tc - tabVis))}${term.reset}`;
}

function drawNotesTab(): string {
  const ns = state.notesState;
  const tc = totalCols();
  const fw = folderPanelWidth();
  const nw = notePanelWidth();
  const cw = contentPanelWidth();
  const br = bodyRows();

  let buf = "";

  // Header
  const folderLabel =
    ns.focus === "folders"
      ? `${term.underline}Folders${term.reset}${term.inverse}${term.bold}`
      : "Folders";
  const noteLabel =
    ns.focus === "notes"
      ? `${term.underline}Notes${term.reset}${term.inverse}${term.bold}`
      : "Notes";
  const contentLabel =
    ns.focus === "content"
      ? `${term.underline}Content${term.reset}${term.inverse}${term.bold}`
      : "Content";
  const headerText = ` ${folderLabel} → ${noteLabel} → ${contentLabel} `;
  const headerVis = visibleLength(headerText);
  buf += `${term.inverse}${term.bold}${headerText}${" ".repeat(Math.max(0, tc - headerVis))}${term.reset}`;

  // Body rows
  for (let row = 0; row < br; row++) {
    buf += moveTo(row + 2, 0);

    // Folder panel
    const treeIdx = row + ns.treeScroll;
    if (treeIdx < ns.tree.length) {
      const item = ns.tree[treeIdx] as TreeItem;
      const isSelected = treeIdx === ns.treeIndex;
      const isFocused = ns.focus === "folders";

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

    buf += `${term.dim}│${term.reset}`;

    // Note list panel
    const noteIdx = row + ns.noteScroll;
    if (noteIdx < ns.notes.length) {
      const note = ns.notes[noteIdx] as NoteMeta;
      const isSelected = noteIdx === ns.noteIndex;
      const isFocused = ns.focus === "notes";

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

    buf += `${term.dim}│${term.reset}`;

    // Content panel
    const contentIdx = row + ns.contentScroll;
    if (contentIdx >= 0 && contentIdx < ns.contentLines.length) {
      const line = ns.contentLines[contentIdx] as string;
      buf += ` ${truncate(line, cw - 1)}`;
    }
  }

  return buf;
}

function drawMessagesTab(): string {
  const ms = state.messagesState;
  const tc = totalCols();
  const cpw = chatPanelWidth();
  const mpw = messagePanelWidth();
  const br = bodyRows();

  let buf = "";

  // Header
  const chatsLabel =
    ms.focus === "chats"
      ? `${term.underline}Chats${term.reset}${term.inverse}${term.bold}`
      : "Chats";
  const msgsLabel =
    ms.focus === "messages"
      ? `${term.underline}Messages${term.reset}${term.inverse}${term.bold}`
      : "Messages";

  const chatInfo = ms.chats[ms.chatIndex];
  const chatName = chatInfo
    ? ` — ${chatInfo.displayName}${chatInfo.isGroup ? " (group)" : ""}`
    : "";

  const headerText = ` ${chatsLabel} → ${msgsLabel}${term.dim}${chatName}${term.reset}${term.inverse}${term.bold} `;
  const headerVis = visibleLength(headerText);
  buf += `${term.inverse}${term.bold}${headerText}${" ".repeat(Math.max(0, tc - headerVis))}${term.reset}`;

  // Body rows
  for (let row = 0; row < br; row++) {
    buf += moveTo(row + 2, 0);

    // Chat list panel
    const chatIdx = row + ms.chatScroll;
    if (chatIdx < ms.chats.length) {
      const chat = ms.chats[chatIdx] as Chat;
      const isSelected = chatIdx === ms.chatIndex;
      const isFocused = ms.focus === "chats";

      const date = chat.lastMessageDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const groupIcon = chat.isGroup ? "👥" : "💬";
      const nameSpace = cpw - date.length - 5;
      const name = truncate(chat.displayName, Math.max(5, nameSpace));
      const gap = cpw - visibleLength(name) - date.length - 4;
      const line = ` ${groupIcon} ${name}${" ".repeat(Math.max(1, gap))}${term.dim}${date}${term.reset}`;

      if (isSelected && isFocused) {
        buf += `${term.inverse}${term.bold}${pad(line, cpw)}${term.reset}`;
      } else if (isSelected) {
        buf += `${term.bold}${pad(line, cpw)}${term.reset}`;
      } else {
        buf += pad(line, cpw);
      }
    } else {
      buf += " ".repeat(cpw);
    }

    buf += `${term.dim}│${term.reset}`;

    // Messages panel — each message takes 2 visual rows
    const msgIdx = Math.floor((row + ms.messageScroll) / 2);
    const subRow = (row + ms.messageScroll) % 2;

    if (msgIdx >= 0 && msgIdx < ms.messages.length) {
      const msg = ms.messages[msgIdx] as MessageMeta;
      const { line1, line2 } = formatMessageLine(msg, mpw);
      const isFocused = ms.focus === "messages";

      if (subRow === 0) {
        buf += isFocused ? line1 : `${term.dim}${line1}${term.reset}`;
      } else {
        buf += line2;
      }
    }
  }

  return buf;
}

function draw() {
  const tc = totalCols();
  const tr = totalRows();

  let buf = term.clear + moveTo(0, 0);

  // Tab bar
  buf += drawTabBar();

  // Tab-specific header + body (starts at row 1)
  buf += moveTo(1, 0);
  if (state.tab === "notes") {
    buf += drawNotesTab();
  } else {
    buf += drawMessagesTab();
  }

  // Footer bar
  buf += moveTo(tr - 1, 0);
  let footer: string;
  if (state.searchMode) {
    footer = ` /${state.searchQuery}█  ${term.dim}Enter=search  Esc=cancel${term.reset}`;
  } else if (state.statusMessage) {
    footer = ` ${state.statusMessage}`;
  } else if (state.tab === "notes") {
    footer = ` ${term.dim}1/2${term.reset} tabs  ${term.dim}←→${term.reset} panels  ${term.dim}↑↓${term.reset} navigate  ${term.dim}j/k${term.reset} scroll  ${term.dim}o${term.reset} open  ${term.dim}/${term.reset} search  ${term.dim}q${term.reset} quit`;
  } else {
    footer = ` ${term.dim}1/2${term.reset} tabs  ${term.dim}←→${term.reset} panels  ${term.dim}↑↓${term.reset} navigate  ${term.dim}j/k${term.reset} scroll  ${term.dim}/${term.reset} search  ${term.dim}q${term.reset} quit`;
  }
  buf += `${term.inverse}${pad(footer, tc)}${term.reset}`;

  write(buf);
}

// ── Input handling ───────────────────────────────────────────────────────────

function doNotesSearch() {
  const query = state.searchQuery.trim();
  state.searchMode = false;
  if (!query) {
    loadNotesForFolder();
    state.statusMessage = "";
    return;
  }
  state.notesState.notes = notesDb.search(query);
  state.statusMessage = `${state.notesState.notes.length} result${state.notesState.notes.length === 1 ? "" : "s"} for "${query}"`;
  state.notesState.noteIndex = 0;
  state.notesState.noteScroll = 0;
  loadSelectedNote();
}

function doMessagesSearch() {
  const query = state.searchQuery.trim();
  state.searchMode = false;
  if (!query) {
    loadChats();
    state.statusMessage = "";
    return;
  }
  state.messagesState.chats = messagesDb.chats({ search: query });
  state.statusMessage = `${state.messagesState.chats.length} chat${state.messagesState.chats.length === 1 ? "" : "s"} matching "${query}"`;
  state.messagesState.chatIndex = 0;
  state.messagesState.chatScroll = 0;
  loadSelectedChat();
}

function clearSearch() {
  state.searchMode = false;
  state.searchQuery = "";
  state.statusMessage = "";
  if (state.tab === "notes") {
    loadNotesForFolder();
  } else {
    loadChats();
  }
}

function cleanup() {
  write(term.altScreenOff + term.cursorShow);
  process.stdin.setRawMode(false);
  notesDb.close();
  messagesDb.close();
}

function handleNotesInput(s: string) {
  const ns = state.notesState;
  const maxContentScroll = Math.max(0, ns.contentLines.length - bodyRows());

  switch (s) {
    // Left/right — switch panels
    case "\x1b[D": // Left arrow
      if (ns.focus === "content") ns.focus = "notes";
      else if (ns.focus === "notes") ns.focus = "folders";
      break;
    case "\x1b[C": // Right arrow
      if (ns.focus === "folders") ns.focus = "notes";
      else if (ns.focus === "notes") ns.focus = "content";
      break;

    // Up/down
    case "\x1b[A": // Up
      if (ns.focus === "folders") selectTreeItem(ns.treeIndex - 1);
      else if (ns.focus === "notes") selectNote(ns.noteIndex - 1);
      else ns.contentScroll = Math.max(0, ns.contentScroll - 1);
      break;
    case "\x1b[B": // Down
      if (ns.focus === "folders") selectTreeItem(ns.treeIndex + 1);
      else if (ns.focus === "notes") selectNote(ns.noteIndex + 1);
      else ns.contentScroll = Math.min(maxContentScroll, ns.contentScroll + 1);
      break;
    case "\x1b[5~": // Page Up
      if (ns.focus === "folders") selectTreeItem(ns.treeIndex - bodyRows());
      else if (ns.focus === "notes") selectNote(ns.noteIndex - bodyRows());
      else ns.contentScroll = Math.max(0, ns.contentScroll - bodyRows());
      break;
    case "\x1b[6~": // Page Down
      if (ns.focus === "folders") selectTreeItem(ns.treeIndex + bodyRows());
      else if (ns.focus === "notes") selectNote(ns.noteIndex + bodyRows());
      else
        ns.contentScroll = Math.min(
          maxContentScroll,
          ns.contentScroll + bodyRows(),
        );
      break;

    // j/k — always scroll content
    case "k":
      ns.contentScroll = Math.max(0, ns.contentScroll - 1);
      break;
    case "K":
      ns.contentScroll = Math.max(0, ns.contentScroll - bodyRows());
      break;
    case "j":
      ns.contentScroll = Math.min(maxContentScroll, ns.contentScroll + 1);
      break;
    case "J":
      ns.contentScroll = Math.min(
        maxContentScroll,
        ns.contentScroll + bodyRows(),
      );
      break;

    case "o": {
      const urls: string[] = [];
      for (const a of ns.attachments) {
        if (a.url) urls.push(a.url);
      }
      if (ns.rawMarkdown) {
        const inlineRe = /!\[.*?\]\(attachment:([^?)]+)/g;
        for (const match of ns.rawMarkdown.matchAll(inlineRe)) {
          const id = match[1] as string;
          const url = notesDb.getAttachmentUrl(id);
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
  }
}

function handleMessagesInput(s: string) {
  const ms = state.messagesState;
  // Each message takes 2 visual rows
  const maxMsgScroll = Math.max(0, ms.messages.length * 2 - bodyRows());

  switch (s) {
    // Left/right — switch panels
    case "\x1b[D": // Left arrow
      if (ms.focus === "messages") ms.focus = "chats";
      break;
    case "\x1b[C": // Right arrow
      if (ms.focus === "chats") ms.focus = "messages";
      break;

    // Up/down
    case "\x1b[A": // Up
      if (ms.focus === "chats") selectChat(ms.chatIndex - 1);
      else ms.messageScroll = Math.max(0, ms.messageScroll - 1);
      break;
    case "\x1b[B": // Down
      if (ms.focus === "chats") selectChat(ms.chatIndex + 1);
      else ms.messageScroll = Math.min(maxMsgScroll, ms.messageScroll + 1);
      break;
    case "\x1b[5~": // Page Up
      if (ms.focus === "chats") selectChat(ms.chatIndex - bodyRows());
      else ms.messageScroll = Math.max(0, ms.messageScroll - bodyRows());
      break;
    case "\x1b[6~": // Page Down
      if (ms.focus === "chats") selectChat(ms.chatIndex + bodyRows());
      else
        ms.messageScroll = Math.min(
          maxMsgScroll,
          ms.messageScroll + bodyRows(),
        );
      break;

    // j/k — always scroll messages
    case "k":
      ms.messageScroll = Math.max(0, ms.messageScroll - 1);
      break;
    case "K":
      ms.messageScroll = Math.max(0, ms.messageScroll - bodyRows());
      break;
    case "j":
      ms.messageScroll = Math.min(maxMsgScroll, ms.messageScroll + 1);
      break;
    case "J":
      ms.messageScroll = Math.min(maxMsgScroll, ms.messageScroll + bodyRows());
      break;
  }
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
      if (state.tab === "notes") doNotesSearch();
      else doMessagesSearch();
    } else if (s === "\x7f" || s === "\b") {
      state.searchQuery = state.searchQuery.slice(0, -1);
    } else if (s.length === 1 && s >= " ") {
      state.searchQuery += s;
    }
    draw();
    return;
  }

  // Global keys
  switch (s) {
    case "q":
      cleanup();
      process.exit(0);
      return;
    case "1":
      if (state.tab !== "notes") {
        state.tab = "notes";
        state.statusMessage = "";
      }
      draw();
      return;
    case "2":
      if (state.tab !== "messages") {
        state.tab = "messages";
        state.statusMessage = "";
        if (state.messagesState.chats.length === 0) loadChats();
      }
      draw();
      return;
    case "/":
      state.searchMode = true;
      state.searchQuery = "";
      draw();
      return;
    case "\x1b":
      if (state.statusMessage) clearSearch();
      draw();
      return;
  }

  // Tab-specific keys
  if (state.tab === "notes") {
    handleNotesInput(s);
  } else {
    handleMessagesInput(s);
  }

  draw();
}

// ── Main ─────────────────────────────────────────────────────────────────────

try {
  notesDb = new Notes();
} catch (error) {
  if (error instanceof DatabaseAccessDeniedError) {
    console.error(error.message);
    console.error("\nOpening Full Disk Access settings...");
    error.openSettings();
    process.exit(1);
  }
  throw error;
}

try {
  messagesDb = new Messages();
} catch (error) {
  if (error instanceof DatabaseAccessDeniedError) {
    console.error(error.message);
    console.error("\nOpening Full Disk Access settings...");
    error.openSettings();
    process.exit(1);
  }
  throw error;
}

state.notesState.allNotes = notesDb.notes();
state.notesState.tree = buildFolderTree(notesDb);

// Enter TUI mode
write(term.altScreenOn + term.cursorHide);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", handleInput);
process.stdout.on("resize", draw);

// Select "All Notes" and load
selectTreeItem(0);
draw();
