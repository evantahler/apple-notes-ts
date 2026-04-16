import type { Folder, NoteMeta, Notes } from "../src/notes/index.ts";
import { PasswordProtectedError } from "../src/notes/index.ts";
import {
  type AppState,
  bodyRows,
  contentPanelWidth,
  folderPanelWidth,
  handleScrollKeys,
  highlightLine,
  hyperlink,
  moveTo,
  notePanelWidth,
  renderMarkdown,
  scrollIntoView,
  type TreeItem,
  term,
  totalCols,
  truncate,
  visibleLength,
} from "./helpers.ts";

// ── Folder tree ─────────────────────────────────────────────────────────────

export function buildFolderTree(notesDb: Notes): TreeItem[] {
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

// ── Actions ─────────────────────────────────────────────────────────────────

export function loadNotesForFolder(state: AppState, notesDb: Notes) {
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
  loadSelectedNote(state, notesDb);
}

export function loadSelectedNote(state: AppState, notesDb: Notes) {
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

export function selectTreeItem(state: AppState, notesDb: Notes, index: number) {
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

  loadNotesForFolder(state, notesDb);
}

export function selectNote(state: AppState, notesDb: Notes, index: number) {
  const ns = state.notesState;
  const result = scrollIntoView(
    index,
    ns.noteScroll,
    ns.notes.length - 1,
    bodyRows(),
  );
  ns.noteIndex = result.index;
  ns.noteScroll = result.scroll;
  loadSelectedNote(state, notesDb);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

export function drawNotesTab(state: AppState): string {
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

      buf += highlightLine(line, fw, isSelected, isFocused);
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

      buf += highlightLine(line, nw, isSelected, isFocused);
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

// ── Input ───────────────────────────────────────────────────────────────────

export function handleNotesInput(state: AppState, notesDb: Notes, s: string) {
  const ns = state.notesState;
  const maxContentScroll = Math.max(0, ns.contentLines.length - bodyRows());

  // j/k scroll keys (always scroll content)
  const scrollResult = handleScrollKeys(s, ns.contentScroll, maxContentScroll);
  if (scrollResult !== null) {
    ns.contentScroll = scrollResult;
    return;
  }

  switch (s) {
    case "\x1b[D": // Left arrow
      if (ns.focus === "content") ns.focus = "notes";
      else if (ns.focus === "notes") ns.focus = "folders";
      break;
    case "\x1b[C": // Right arrow
      if (ns.focus === "folders") ns.focus = "notes";
      else if (ns.focus === "notes") ns.focus = "content";
      break;
    case "\x1b[A": // Up
      if (ns.focus === "folders")
        selectTreeItem(state, notesDb, ns.treeIndex - 1);
      else if (ns.focus === "notes")
        selectNote(state, notesDb, ns.noteIndex - 1);
      else ns.contentScroll = Math.max(0, ns.contentScroll - 1);
      break;
    case "\x1b[B": // Down
      if (ns.focus === "folders")
        selectTreeItem(state, notesDb, ns.treeIndex + 1);
      else if (ns.focus === "notes")
        selectNote(state, notesDb, ns.noteIndex + 1);
      else ns.contentScroll = Math.min(maxContentScroll, ns.contentScroll + 1);
      break;
    case "\x1b[5~": // Page Up
      if (ns.focus === "folders")
        selectTreeItem(state, notesDb, ns.treeIndex - bodyRows());
      else if (ns.focus === "notes")
        selectNote(state, notesDb, ns.noteIndex - bodyRows());
      else ns.contentScroll = Math.max(0, ns.contentScroll - bodyRows());
      break;
    case "\x1b[6~": // Page Down
      if (ns.focus === "folders")
        selectTreeItem(state, notesDb, ns.treeIndex + bodyRows());
      else if (ns.focus === "notes")
        selectNote(state, notesDb, ns.noteIndex + bodyRows());
      else
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

// ── Search ──────────────────────────────────────────────────────────────────

export function doNotesSearch(state: AppState, notesDb: Notes) {
  const query = state.searchQuery.trim();
  state.searchMode = false;
  if (!query) {
    loadNotesForFolder(state, notesDb);
    state.statusMessage = "";
    return;
  }
  state.notesState.notes = notesDb.search(query);
  state.statusMessage = `${state.notesState.notes.length} result${state.notesState.notes.length === 1 ? "" : "s"} for "${query}"`;
  state.notesState.noteIndex = 0;
  state.notesState.noteScroll = 0;
  loadSelectedNote(state, notesDb);
}
