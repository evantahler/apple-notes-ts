/**
 * Interactive TUI for browsing Apple Notes, Messages, Contacts, and Photos.
 *
 * Requires Full Disk Access for the terminal running this script.
 * Run with: bun tui
 */

import { Contacts } from "./src/contacts/index.ts";
import { DatabaseAccessDeniedError } from "./src/index.ts";
import { Messages } from "./src/messages/index.ts";
import { Notes } from "./src/notes/index.ts";
import { Photos } from "./src/photos/index.ts";
import {
  doContactsSearch,
  drawContactsTab,
  handleContactsInput,
  loadContactsForGroup,
  selectGroup,
} from "./tui/contacts.ts";
import {
  type AppState,
  buildFooter,
  moveTo,
  pad,
  term,
  totalCols,
  totalRows,
  visibleLength,
  write,
} from "./tui/helpers.ts";
import {
  doMessagesSearch,
  drawMessagesTab,
  handleMessagesInput,
  loadChats,
} from "./tui/messages.ts";
import {
  buildFolderTree,
  doNotesSearch,
  drawNotesTab,
  handleNotesInput,
  loadNotesForFolder,
  selectTreeItem,
} from "./tui/notes.ts";
import {
  doPhotosSearch,
  drawPhotosTab,
  handlePhotosInput,
  loadPhotosForAlbum,
  selectAlbum,
} from "./tui/photos.ts";

// ── State ───────────────────────────────────────────────────────────────────

let notesDb: Notes;
let messagesDb: Messages;
let contactsDb: Contacts;
let photosDb: Photos;

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
  contactsState: {
    focus: "groups",
    groups: [],
    groupIndex: 0,
    groupScroll: 0,
    contacts: [],
    allContacts: [],
    contactIndex: 0,
    contactScroll: 0,
    details: null,
    detailLines: [],
    detailScroll: 0,
  },
  photosState: {
    focus: "albums",
    albums: [],
    albumIndex: 0,
    albumScroll: 0,
    photos: [],
    allPhotos: [],
    photoIndex: 0,
    photoScroll: 0,
    detailLines: [],
    detailScroll: 0,
  },
};

// ── Drawing ─────────────────────────────────────────────────────────────────

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
  const contactsTab =
    state.tab === "contacts"
      ? `${term.bold}${term.underline} 3 Contacts ${term.reset}${term.inverse}`
      : `${term.dim} 3 Contacts ${term.reset}${term.inverse}`;
  const photosTab =
    state.tab === "photos"
      ? `${term.bold}${term.underline} 4 Photos ${term.reset}${term.inverse}`
      : `${term.dim} 4 Photos ${term.reset}${term.inverse}`;

  const tabText = `${notesTab}  ${msgsTab}  ${contactsTab}  ${photosTab} `;
  const tabVis = visibleLength(tabText);
  return `${term.inverse}${tabText}${" ".repeat(Math.max(0, tc - tabVis))}${term.reset}`;
}

function draw() {
  const tc = totalCols();
  const tr = totalRows();

  let buf = term.clear + moveTo(0, 0);

  // Tab bar
  buf += drawTabBar();

  // Tab-specific header + body
  buf += moveTo(1, 0);
  if (state.tab === "notes") {
    buf += drawNotesTab(state);
  } else if (state.tab === "messages") {
    buf += drawMessagesTab(state);
  } else if (state.tab === "contacts") {
    buf += drawContactsTab(state);
  } else {
    buf += drawPhotosTab(state);
  }

  // Footer bar
  buf += moveTo(tr - 1, 0);
  let footer: string;
  if (state.searchMode) {
    footer = ` /${state.searchQuery}█  ${term.dim}Enter=search  Esc=cancel${term.reset}`;
  } else if (state.statusMessage) {
    footer = ` ${state.statusMessage}`;
  } else {
    footer = buildFooter(state.tab);
  }
  buf += `${term.inverse}${pad(footer, tc)}${term.reset}`;

  write(buf);
}

// ── Input handling ──────────────────────────────────────────────────────────

function clearSearch() {
  state.searchMode = false;
  state.searchQuery = "";
  state.statusMessage = "";
  if (state.tab === "notes") {
    loadNotesForFolder(state, notesDb);
  } else if (state.tab === "messages") {
    loadChats(state, messagesDb);
  } else if (state.tab === "contacts") {
    loadContactsForGroup(state, contactsDb);
  } else {
    loadPhotosForAlbum(state, photosDb);
  }
}

function cleanup() {
  write(term.altScreenOff + term.cursorShow);
  process.stdin.setRawMode(false);
  notesDb.close();
  messagesDb.close();
  contactsDb.close();
  photosDb.close();
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
      if (state.tab === "notes") doNotesSearch(state, notesDb);
      else if (state.tab === "messages") doMessagesSearch(state, messagesDb);
      else if (state.tab === "contacts") doContactsSearch(state, contactsDb);
      else doPhotosSearch(state, photosDb);
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
        if (state.messagesState.chats.length === 0)
          loadChats(state, messagesDb);
      }
      draw();
      return;
    case "3":
      if (state.tab !== "contacts") {
        state.tab = "contacts";
        state.statusMessage = "";
        if (state.contactsState.allContacts.length === 0) {
          state.contactsState.allContacts = contactsDb.contacts();
          state.contactsState.groups = contactsDb.groups();
          selectGroup(state, contactsDb, 0);
        }
      }
      draw();
      return;
    case "4":
      if (state.tab !== "photos") {
        state.tab = "photos";
        state.statusMessage = "";
        if (state.photosState.allPhotos.length === 0) {
          state.photosState.allPhotos = photosDb.photos({ limit: 500 });
          state.photosState.albums = photosDb.albums();
          selectAlbum(state, photosDb, 0);
        }
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
    handleNotesInput(state, notesDb, s);
  } else if (state.tab === "messages") {
    handleMessagesInput(state, messagesDb, s);
  } else if (state.tab === "contacts") {
    handleContactsInput(state, contactsDb, s);
  } else {
    handlePhotosInput(state, photosDb, s);
  }

  draw();
}

// ── Main ────────────────────────────────────────────────────────────────────

function initDb<T>(DbClass: new () => T): T {
  try {
    return new DbClass();
  } catch (error) {
    if (error instanceof DatabaseAccessDeniedError) {
      console.error(error.message);
      console.error("\nOpening Full Disk Access settings...");
      error.openSettings();
      process.exit(1);
    }
    throw error;
  }
}

notesDb = initDb(Notes);
messagesDb = initDb(Messages);
contactsDb = initDb(Contacts);
photosDb = initDb(Photos);

state.notesState.allNotes = notesDb.notes();
state.notesState.tree = buildFolderTree(notesDb);

// Enter TUI mode
write(term.altScreenOn + term.cursorHide);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", handleInput);
process.stdout.on("resize", draw);

// Select "All Notes" and load
selectTreeItem(state, notesDb, 0);
draw();
