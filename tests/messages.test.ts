import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Messages } from "../src/index.ts";
import {
  ChatNotFoundError,
  MessageNotFoundError,
} from "../src/messages/errors.ts";

const FIXTURE_DB = resolve(import.meta.dir, "fixtures/chat.db");

let db: Messages;

beforeAll(() => {
  db = new Messages({ dbPath: FIXTURE_DB });
});

afterAll(() => {
  db.close();
});

// ============================================================================
// handles()
// ============================================================================

describe("handles", () => {
  test("returns all handles", () => {
    const handles = db.handles();
    expect(handles).toHaveLength(3);
  });

  test("handles have identifier and service", () => {
    const handles = db.handles();
    const phone = handles.find((h) => h.identifier === "+15551234567");
    expect(phone).toBeDefined();
    expect(phone?.service).toBe("iMessage");

    const email = handles.find((h) => h.identifier === "alice@example.com");
    expect(email).toBeDefined();
    expect(email?.service).toBe("iMessage");
  });
});

// ============================================================================
// chats()
// ============================================================================

describe("chats", () => {
  test("returns all chats", () => {
    const chats = db.chats();
    expect(chats).toHaveLength(3);
  });

  test("DM chats have isGroup=false", () => {
    const chats = db.chats();
    const dm = chats.find((c) => c.chatIdentifier === "+15551234567");
    expect(dm).toBeDefined();
    expect(dm?.isGroup).toBe(false);
  });

  test("group chats have isGroup=true", () => {
    const chats = db.chats();
    const group = chats.find((c) => c.displayName === "Weekend Plans");
    expect(group).toBeDefined();
    expect(group?.isGroup).toBe(true);
  });

  test("group chat has all participants", () => {
    const chats = db.chats();
    const group = chats.find((c) => c.displayName === "Weekend Plans");
    expect(group?.participants).toHaveLength(3);
    expect(group?.participants).toContain("+15551234567");
    expect(group?.participants).toContain("+15559876543");
    expect(group?.participants).toContain("alice@example.com");
  });

  test("chats have lastMessageDate", () => {
    const chats = db.chats();
    for (const c of chats) {
      expect(c.lastMessageDate).toBeInstanceOf(Date);
      expect(c.lastMessageDate.getTime()).toBeGreaterThan(0);
    }
  });

  test("defaults to sorting by lastMessageDate descending", () => {
    const chats = db.chats();
    const dates = chats.map((c) => c.lastMessageDate.getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1] as number);
    }
  });

  test("sorts by displayName ascending", () => {
    const chats = db.chats({ sortBy: "displayName", order: "asc" });
    const names = chats.map((c) => c.displayName);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("search filters by display name", () => {
    const chats = db.chats({ search: "Weekend" });
    expect(chats).toHaveLength(1);
    expect(chats[0]?.displayName).toBe("Weekend Plans");
  });

  test("search filters by participant handle", () => {
    const chats = db.chats({ search: "alice" });
    expect(chats.length).toBeGreaterThan(0);
    const hasAlice = chats.every(
      (c) =>
        c.participants.some((p) => p.includes("alice")) ||
        c.chatIdentifier.includes("alice"),
    );
    expect(hasAlice).toBe(true);
  });

  test("limit restricts result count", () => {
    const all = db.chats();
    const limited = db.chats({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited.length).toBeLessThan(all.length);
  });
});

// ============================================================================
// getChat()
// ============================================================================

describe("getChat", () => {
  test("returns a single chat by ID", () => {
    const chat = db.getChat(1);
    expect(chat.id).toBe(1);
    expect(chat.chatIdentifier).toBe("+15551234567");
  });

  test("throws ChatNotFoundError for missing chat", () => {
    expect(() => db.getChat(99999)).toThrow(ChatNotFoundError);
  });
});

// ============================================================================
// messages()
// ============================================================================

describe("messages", () => {
  test("returns messages for a chat", () => {
    const msgs = db.messages(1);
    expect(msgs.length).toBeGreaterThan(0);
  });

  test("messages have expected fields", () => {
    const msgs = db.messages(1);
    const msg = msgs[0] as (typeof msgs)[0];
    expect(msg.id).toBeDefined();
    expect(msg.guid).toBeDefined();
    expect(typeof msg.text).toBe("string");
    expect(typeof msg.isFromMe).toBe("boolean");
    expect(msg.date).toBeInstanceOf(Date);
    expect(typeof msg.service).toBe("string");
  });

  test("defaults to date descending", () => {
    const msgs = db.messages(1);
    const dates = msgs.map((m) => m.date.getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1] as number);
    }
  });

  test("sorts ascending", () => {
    const msgs = db.messages(1, { order: "asc" });
    const dates = msgs.map((m) => m.date.getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1] as number);
    }
  });

  test("limit restricts result count", () => {
    const all = db.messages(1);
    const limited = db.messages(1, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.length).toBeLessThan(all.length);
  });

  test("filters by fromMe=true", () => {
    const sent = db.messages(1, { fromMe: true });
    for (const m of sent) {
      expect(m.isFromMe).toBe(true);
    }
  });

  test("filters by fromMe=false", () => {
    const received = db.messages(1, { fromMe: false });
    for (const m of received) {
      expect(m.isFromMe).toBe(false);
    }
  });

  test("filters by afterDate", () => {
    const afterDate = new Date("2025-06-14T00:00:00Z");
    const msgs = db.messages(1, { afterDate });
    for (const m of msgs) {
      expect(m.date.getTime()).toBeGreaterThan(afterDate.getTime());
    }
  });

  test("filters by beforeDate", () => {
    const beforeDate = new Date("2025-06-14T00:00:00Z");
    const msgs = db.messages(1, { beforeDate });
    for (const m of msgs) {
      expect(m.date.getTime()).toBeLessThan(beforeDate.getTime());
    }
  });

  test("throws ChatNotFoundError for missing chat", () => {
    expect(() => db.messages(99999)).toThrow(ChatNotFoundError);
  });

  test("includes messages from different services in group chat", () => {
    const msgs = db.messages(3);
    const services = new Set(msgs.map((m) => m.service));
    expect(services.has("iMessage")).toBe(true);
    expect(services.has("SMS")).toBe(true);
  });

  test("thread replies have threadOriginatorGuid", () => {
    const msgs = db.messages(3);
    const reply = msgs.find((m) => m.threadOriginatorGuid != null);
    expect(reply).toBeDefined();
    expect(reply?.threadOriginatorGuid).toBe("msg-guid-10");
  });
});

// ============================================================================
// getMessage()
// ============================================================================

describe("getMessage", () => {
  test("returns a single message by ID", () => {
    const msg = db.getMessage(1);
    expect(msg.id).toBe(1);
    expect(msg.text).toBe("Hey, how are you?");
    expect(msg.isFromMe).toBe(false);
  });

  test("throws MessageNotFoundError for missing message", () => {
    expect(() => db.getMessage(99999)).toThrow(MessageNotFoundError);
  });
});

// ============================================================================
// attributedBody decoding
// ============================================================================

describe("attributedBody decoding", () => {
  test("extracts text from attributedBody when text column is null", () => {
    // Message 6 in chat 2 has attributedBody only
    const msgs = db.messages(2, { order: "asc" });
    const attrMsg = msgs.find((m) => m.text === "Check out this cool project!");
    expect(attrMsg).toBeDefined();
    expect(attrMsg?.text).toBe("Check out this cool project!");
  });
});

// ============================================================================
// search()
// ============================================================================

describe("search", () => {
  test("finds messages by text content", () => {
    const results = db.search("lunch");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.text.includes("lunch"))).toBe(true);
  });

  test("search is case-insensitive (SQL LIKE)", () => {
    const results = db.search("LUNCH");
    expect(results.length).toBeGreaterThan(0);
  });

  test("restricts search to a specific chat", () => {
    const results = db.search("free", { chatId: 3 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.chatId).toBe(3);
    }
  });

  test("respects limit", () => {
    const results = db.search("i", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("returns empty for non-matching query", () => {
    const results = db.search("xyznonexistent999");
    expect(results).toHaveLength(0);
  });
});

// ============================================================================
// attachments()
// ============================================================================

describe("attachments", () => {
  test("returns attachments for a message with attachments", () => {
    // Find a message with hasAttachments=true
    const msgs = db.messages(2);
    const withAtt = msgs.find((m) => m.hasAttachments);
    expect(withAtt).toBeDefined();

    const atts = db.attachments(withAtt?.id as number);
    expect(atts.length).toBeGreaterThan(0);
    expect(atts[0]?.mimeType).toBe("image/png");
    expect(atts[0]?.transferName).toBe("screenshot.png");
    expect(atts[0]?.totalBytes).toBe(524288);
  });

  test("returns empty array for message without attachments", () => {
    const atts = db.attachments(1);
    expect(atts).toHaveLength(0);
  });
});

// ============================================================================
// close()
// ============================================================================

describe("close", () => {
  test("does not throw", () => {
    const tempDb = new Messages({ dbPath: FIXTURE_DB });
    expect(() => tempDb.close()).not.toThrow();
  });
});
