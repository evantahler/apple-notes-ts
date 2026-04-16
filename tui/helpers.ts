import type { Contact, ContactDetails, Group } from "../src/contacts/index.ts";
import type { Chat, MessageMeta } from "../src/messages/index.ts";
import type { AttachmentRef, Folder, NoteMeta } from "../src/notes/index.ts";
import type { Album, PhotoMeta } from "../src/photos/index.ts";

// ── Terminal constants ──────────────────────────────────────────────────────

const ESC = "\x1b";
const CSI = `${ESC}[`;

export const term = {
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

export function moveTo(row: number, col: number): string {
  return `${CSI}${row + 1};${col + 1}H`;
}

export function hyperlink(url: string, text: string): string {
  return `${ESC}]8;;${url}\x07${text}${ESC}]8;;\x07`;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences and OSC 8 hyperlinks
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

export function truncate(s: string, max: number): string {
  let visible = 0;
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      const end = s.indexOf("m", i);
      if (end !== -1) {
        result += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
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

export function pad(s: string, width: number): string {
  const vl = visibleLength(s);
  if (vl >= width) return truncate(s, width);
  return s + " ".repeat(width - vl);
}

export function write(s: string) {
  process.stdout.write(s);
}

// ── Markdown rendering ──────────────────────────────────────────────────────

export function renderMarkdown(markdown: string, width: number): string[] {
  const rendered = Bun.markdown.ansi(markdown, {
    columns: Math.max(width - 2, 20),
    hyperlinks: true,
  });
  return rendered.split("\n");
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function totalCols(): number {
  return process.stdout.columns || 80;
}
export function totalRows(): number {
  return process.stdout.rows || 24;
}
export function bodyRows(): number {
  return totalRows() - 3;
}

// Notes layout
export function folderPanelWidth(): number {
  return Math.max(20, Math.min(35, Math.floor(totalCols() * 0.2)));
}
export function notePanelWidth(): number {
  return Math.max(25, Math.min(45, Math.floor(totalCols() * 0.25)));
}
export function contentPanelWidth(): number {
  return totalCols() - folderPanelWidth() - notePanelWidth() - 2;
}

// Messages layout
export function chatPanelWidth(): number {
  return Math.max(25, Math.min(45, Math.floor(totalCols() * 0.3)));
}
export function messagePanelWidth(): number {
  return totalCols() - chatPanelWidth() - 1;
}

// Photos layout
export function photoAlbumPanelWidth(): number {
  return Math.max(20, Math.min(30, Math.floor(totalCols() * 0.18)));
}
export function photoListPanelWidth(): number {
  return Math.max(25, Math.min(45, Math.floor(totalCols() * 0.3)));
}
export function photoDetailPanelWidth(): number {
  return totalCols() - photoAlbumPanelWidth() - photoListPanelWidth() - 2;
}

// Contacts layout
export function groupPanelWidth(): number {
  return Math.max(20, Math.min(30, Math.floor(totalCols() * 0.18)));
}
export function contactListPanelWidth(): number {
  return Math.max(25, Math.min(40, Math.floor(totalCols() * 0.25)));
}
export function contactDetailPanelWidth(): number {
  return totalCols() - groupPanelWidth() - contactListPanelWidth() - 2;
}

// ── State types ─────────────────────────────────────────────────────────────

export type Tab = "notes" | "messages" | "contacts" | "photos";
export type NotesPanel = "folders" | "notes" | "content";
export type MessagesPanel = "chats" | "messages";
export type ContactsPanel = "groups" | "contacts" | "details";
export type PhotosPanel = "albums" | "photos" | "details";

export interface TreeItem {
  label: string;
  folder: Folder | null;
  isAccount: boolean;
  indent: number;
}

export interface NotesState {
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

export interface MessagesState {
  focus: MessagesPanel;
  chats: Chat[];
  chatIndex: number;
  chatScroll: number;
  messages: MessageMeta[];
  messageScroll: number;
}

export interface ContactsState {
  focus: ContactsPanel;
  groups: Group[];
  groupIndex: number;
  groupScroll: number;
  contacts: Contact[];
  allContacts: Contact[];
  contactIndex: number;
  contactScroll: number;
  details: ContactDetails | null;
  detailLines: string[];
  detailScroll: number;
}

export interface PhotosState {
  focus: PhotosPanel;
  albums: Album[];
  albumIndex: number;
  albumScroll: number;
  photos: PhotoMeta[];
  allPhotos: PhotoMeta[];
  photoIndex: number;
  photoScroll: number;
  detailLines: string[];
  detailScroll: number;
}

export interface AppState {
  tab: Tab;
  searchMode: boolean;
  searchQuery: string;
  statusMessage: string;
  notesState: NotesState;
  messagesState: MessagesState;
  contactsState: ContactsState;
  photosState: PhotosState;
}

// ── DRY helpers ─────────────────────────────────────────────────────────────

/**
 * Clamp an index within bounds and adjust scroll to keep it visible.
 * Returns the updated { index, scroll } values.
 */
export function scrollIntoView(
  index: number,
  currentScroll: number,
  maxIndex: number,
  viewportRows: number,
): { index: number; scroll: number } {
  const clamped = Math.max(0, Math.min(index, maxIndex));
  let scroll = currentScroll;
  if (clamped < scroll) {
    scroll = clamped;
  } else if (clamped >= scroll + viewportRows) {
    scroll = clamped - viewportRows + 1;
  }
  return { index: clamped, scroll };
}

/**
 * Apply highlight styling for a panel row based on selection and focus state.
 */
export function highlightLine(
  line: string,
  width: number,
  isSelected: boolean,
  isFocused: boolean,
): string {
  if (isSelected && isFocused) {
    return `${term.inverse}${term.bold}${pad(line, width)}${term.reset}`;
  }
  if (isSelected) {
    return `${term.bold}${pad(line, width)}${term.reset}`;
  }
  return pad(line, width);
}

/**
 * Handle j/k/J/K scroll keys. Returns the new scroll position, or null if the
 * key was not a scroll key.
 */
export function handleScrollKeys(
  key: string,
  currentScroll: number,
  maxScroll: number,
): number | null {
  switch (key) {
    case "k":
      return Math.max(0, currentScroll - 1);
    case "K":
      return Math.max(0, currentScroll - bodyRows());
    case "j":
      return Math.min(maxScroll, currentScroll + 1);
    case "J":
      return Math.min(maxScroll, currentScroll + bodyRows());
    default:
      return null;
  }
}

/**
 * Build the footer bar for a tab.
 */
export function buildFooter(tab: Tab): string {
  const base = `${term.dim}1/2/3/4${term.reset} tabs  ${term.dim}\u2190\u2192${term.reset} panels  ${term.dim}\u2191\u2193${term.reset} navigate  ${term.dim}j/k${term.reset} scroll`;
  const open =
    tab === "notes" || tab === "photos"
      ? `  ${term.dim}o${term.reset} open`
      : "";
  return ` ${base}${open}  ${term.dim}/${term.reset} search  ${term.dim}q${term.reset} quit`;
}
