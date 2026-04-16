import type { Chat, MessageMeta, Messages } from "../src/messages/index.ts";
import {
  type AppState,
  bodyRows,
  chatPanelWidth,
  handleScrollKeys,
  highlightLine,
  messagePanelWidth,
  moveTo,
  scrollIntoView,
  term,
  totalCols,
  truncate,
  visibleLength,
} from "./helpers.ts";

// ── Actions ─────────────────────────────────────────────────────────────────

export function loadChats(state: AppState, messagesDb: Messages) {
  const ms = state.messagesState;
  ms.chats = messagesDb.chats();
  ms.chatIndex = 0;
  ms.chatScroll = 0;
  loadSelectedChat(state, messagesDb);
}

export function loadSelectedChat(state: AppState, messagesDb: Messages) {
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
  const maxScroll = Math.max(0, ms.messages.length * 2 - bodyRows());
  ms.messageScroll = maxScroll;
}

export function selectChat(
  state: AppState,
  messagesDb: Messages,
  index: number,
) {
  const ms = state.messagesState;
  const result = scrollIntoView(
    index,
    ms.chatScroll,
    ms.chats.length - 1,
    bodyRows(),
  );
  ms.chatIndex = result.index;
  ms.chatScroll = result.scroll;
  loadSelectedChat(state, messagesDb);
}

// ── Message formatting ──────────────────────────────────────────────────────

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
  if (msg.isAudioMessage && !text.trim()) text = "\u{1F3A4} Audio message";
  if (msg.hasAttachments && !text.trim()) text = "\u{1F4CE} Attachment";
  const textWidth = Math.max(10, width - 4);
  const line2 = `   ${truncate(text, textWidth)}`;

  return { line1, line2 };
}

// ── Drawing ─────────────────────────────────────────────────────────────────

export function drawMessagesTab(state: AppState): string {
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
      const groupIcon = chat.isGroup ? "\u{1F465}" : "\u{1F4AC}";
      const nameSpace = cpw - date.length - 5;
      const name = truncate(chat.displayName, Math.max(5, nameSpace));
      const gap = cpw - visibleLength(name) - date.length - 4;
      const line = ` ${groupIcon} ${name}${" ".repeat(Math.max(1, gap))}${term.dim}${date}${term.reset}`;

      buf += highlightLine(line, cpw, isSelected, isFocused);
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

// ── Input ───────────────────────────────────────────────────────────────────

export function handleMessagesInput(
  state: AppState,
  messagesDb: Messages,
  s: string,
) {
  const ms = state.messagesState;
  const maxMsgScroll = Math.max(0, ms.messages.length * 2 - bodyRows());

  // j/k scroll keys (always scroll messages)
  const scrollResult = handleScrollKeys(s, ms.messageScroll, maxMsgScroll);
  if (scrollResult !== null) {
    ms.messageScroll = scrollResult;
    return;
  }

  switch (s) {
    case "\x1b[D": // Left arrow
      if (ms.focus === "messages") ms.focus = "chats";
      break;
    case "\x1b[C": // Right arrow
      if (ms.focus === "chats") ms.focus = "messages";
      break;
    case "\x1b[A": // Up
      if (ms.focus === "chats") selectChat(state, messagesDb, ms.chatIndex - 1);
      else ms.messageScroll = Math.max(0, ms.messageScroll - 1);
      break;
    case "\x1b[B": // Down
      if (ms.focus === "chats") selectChat(state, messagesDb, ms.chatIndex + 1);
      else ms.messageScroll = Math.min(maxMsgScroll, ms.messageScroll + 1);
      break;
    case "\x1b[5~": // Page Up
      if (ms.focus === "chats")
        selectChat(state, messagesDb, ms.chatIndex - bodyRows());
      else ms.messageScroll = Math.max(0, ms.messageScroll - bodyRows());
      break;
    case "\x1b[6~": // Page Down
      if (ms.focus === "chats")
        selectChat(state, messagesDb, ms.chatIndex + bodyRows());
      else
        ms.messageScroll = Math.min(
          maxMsgScroll,
          ms.messageScroll + bodyRows(),
        );
      break;
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

export function doMessagesSearch(state: AppState, messagesDb: Messages) {
  const query = state.searchQuery.trim();
  state.searchMode = false;
  if (!query) {
    loadChats(state, messagesDb);
    state.statusMessage = "";
    return;
  }
  state.messagesState.chats = messagesDb.chats({ search: query });
  state.statusMessage = `${state.messagesState.chats.length} chat${state.messagesState.chats.length === 1 ? "" : "s"} matching "${query}"`;
  state.messagesState.chatIndex = 0;
  state.messagesState.chatScroll = 0;
  loadSelectedChat(state, messagesDb);
}
