/**
 * Creates a test chat.db database with realistic iMessage/SMS data.
 * Run with: bun run tests/fixtures/create-messages-db.ts
 *
 * The generated DB is checked into git so tests run without Full Disk Access.
 */

import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";

const FIXTURE_DIR = dirname(new URL(import.meta.url).pathname);
const DB_PATH = resolve(FIXTURE_DIR, "chat.db");

// Mac Absolute Time: nanoseconds since 2001-01-01 for Messages
const MAC_EPOCH_OFFSET = 978307200;
function toMacNanos(date: Date): number {
  return (date.getTime() / 1000 - MAC_EPOCH_OFFSET) * 1e9;
}

// Delete existing DB
try {
  const { unlinkSync } = await import("node:fs");
  try {
    unlinkSync(DB_PATH);
  } catch {}
  try {
    unlinkSync(`${DB_PATH}-wal`);
  } catch {}
  try {
    unlinkSync(`${DB_PATH}-shm`);
  } catch {}
} catch {}

const db = new Database(DB_PATH);

// ============================================================================
// Create schema (simplified version of the real chat.db schema)
// ============================================================================

db.exec(`
  CREATE TABLE handle (
    ROWID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
    id TEXT NOT NULL,
    country TEXT,
    service TEXT NOT NULL,
    uncanonicalized_id TEXT,
    person_centric_id TEXT,
    UNIQUE (id, service)
  );

  CREATE TABLE chat (
    ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT UNIQUE NOT NULL,
    style INTEGER,
    state INTEGER,
    account_id TEXT,
    properties BLOB,
    chat_identifier TEXT,
    service_name TEXT,
    room_name TEXT,
    account_login TEXT,
    is_archived INTEGER DEFAULT 0,
    last_addressed_handle TEXT,
    display_name TEXT,
    group_id TEXT,
    is_filtered INTEGER,
    successful_query INTEGER
  );

  CREATE TABLE message (
    ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT UNIQUE NOT NULL,
    text TEXT,
    replace INTEGER DEFAULT 0,
    service_center TEXT,
    handle_id INTEGER DEFAULT 0,
    subject TEXT,
    country TEXT,
    attributedBody BLOB,
    version INTEGER DEFAULT 0,
    type INTEGER DEFAULT 0,
    service TEXT,
    account TEXT,
    account_guid TEXT,
    error INTEGER DEFAULT 0,
    date INTEGER,
    date_read INTEGER,
    date_delivered INTEGER,
    is_delivered INTEGER DEFAULT 0,
    is_finished INTEGER DEFAULT 0,
    is_emote INTEGER DEFAULT 0,
    is_from_me INTEGER DEFAULT 0,
    is_empty INTEGER DEFAULT 0,
    is_delayed INTEGER DEFAULT 0,
    is_auto_reply INTEGER DEFAULT 0,
    is_prepared INTEGER DEFAULT 0,
    is_read INTEGER DEFAULT 0,
    is_system_message INTEGER DEFAULT 0,
    is_sent INTEGER DEFAULT 0,
    has_dd_results INTEGER DEFAULT 0,
    is_service_message INTEGER DEFAULT 0,
    is_forward INTEGER DEFAULT 0,
    was_downgraded INTEGER DEFAULT 0,
    is_archive INTEGER DEFAULT 0,
    cache_has_attachments INTEGER DEFAULT 0,
    cache_roomnames TEXT,
    was_data_detected INTEGER DEFAULT 0,
    was_deduplicated INTEGER DEFAULT 0,
    is_audio_message INTEGER DEFAULT 0,
    is_played INTEGER DEFAULT 0,
    date_played INTEGER,
    item_type INTEGER DEFAULT 0,
    other_handle INTEGER DEFAULT 0,
    group_title TEXT,
    group_action_type INTEGER DEFAULT 0,
    share_status INTEGER DEFAULT 0,
    share_direction INTEGER DEFAULT 0,
    is_expirable INTEGER DEFAULT 0,
    expire_state INTEGER DEFAULT 0,
    message_action_type INTEGER DEFAULT 0,
    message_source INTEGER DEFAULT 0,
    associated_message_guid TEXT,
    associated_message_type INTEGER DEFAULT 0,
    balloon_bundle_id TEXT,
    payload_data BLOB,
    expressive_send_style_id TEXT,
    associated_message_range_location INTEGER DEFAULT 0,
    associated_message_range_length INTEGER DEFAULT 0,
    time_expressive_send_played INTEGER,
    message_summary_info BLOB,
    ck_sync_state INTEGER DEFAULT 0,
    ck_record_id TEXT,
    ck_record_change_tag TEXT,
    destination_caller_id TEXT,
    is_corrupt INTEGER DEFAULT 0,
    reply_to_guid TEXT,
    sort_id INTEGER,
    is_spam INTEGER DEFAULT 0,
    has_unseen_mention INTEGER DEFAULT 0,
    thread_originator_guid TEXT,
    thread_originator_part TEXT,
    syndication_ranges TEXT,
    synced_syndication_ranges TEXT,
    was_delivered_quietly INTEGER DEFAULT 0,
    did_notify_recipient INTEGER DEFAULT 0,
    date_retracted INTEGER,
    date_edited INTEGER,
    was_detonated INTEGER DEFAULT 0,
    part_count INTEGER,
    is_stewie INTEGER DEFAULT 0,
    is_sos INTEGER DEFAULT 0,
    is_critical INTEGER DEFAULT 0,
    bia_reference_id TEXT,
    is_kt_verified INTEGER DEFAULT 0,
    fallback_hash TEXT,
    associated_message_emoji TEXT,
    is_pending_satellite_send INTEGER DEFAULT 0,
    needs_relay INTEGER DEFAULT 0,
    schedule_type INTEGER DEFAULT 0,
    schedule_state INTEGER DEFAULT 0,
    sent_or_received_off_grid INTEGER DEFAULT 0,
    is_time_sensitive INTEGER DEFAULT 0
  );

  CREATE TABLE attachment (
    ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT UNIQUE NOT NULL,
    created_date INTEGER DEFAULT 0,
    start_date INTEGER DEFAULT 0,
    filename TEXT,
    uti TEXT,
    mime_type TEXT,
    transfer_state INTEGER DEFAULT 0,
    is_outgoing INTEGER DEFAULT 0,
    user_info BLOB,
    transfer_name TEXT,
    total_bytes INTEGER DEFAULT 0,
    is_sticker INTEGER DEFAULT 0,
    sticker_user_info BLOB,
    attribution_info BLOB,
    hide_attachment INTEGER DEFAULT 0,
    ck_sync_state INTEGER DEFAULT 0,
    ck_server_change_token_blob BLOB,
    ck_record_id TEXT,
    original_guid TEXT UNIQUE NOT NULL
  );

  CREATE TABLE chat_message_join (
    chat_id INTEGER REFERENCES chat (ROWID),
    message_id INTEGER REFERENCES message (ROWID),
    message_date INTEGER DEFAULT 0,
    PRIMARY KEY (chat_id, message_id)
  );

  CREATE TABLE chat_handle_join (
    chat_id INTEGER REFERENCES chat (ROWID),
    handle_id INTEGER REFERENCES handle (ROWID),
    UNIQUE(chat_id, handle_id)
  );

  CREATE TABLE message_attachment_join (
    message_id INTEGER REFERENCES message (ROWID),
    attachment_id INTEGER REFERENCES attachment (ROWID),
    UNIQUE(message_id, attachment_id)
  );
`);

// ============================================================================
// Timestamps
// ============================================================================
const now = new Date("2025-06-15T10:00:00Z");
const oneHourAgo = new Date("2025-06-15T09:00:00Z");
const twoHoursAgo = new Date("2025-06-15T08:00:00Z");
const yesterday = new Date("2025-06-14T10:00:00Z");
const lastWeek = new Date("2025-06-08T10:00:00Z");
const lastMonth = new Date("2025-05-15T10:00:00Z");

// ============================================================================
// Handles (contacts)
// ============================================================================

db.query(
  "INSERT INTO handle (ROWID, id, service, country) VALUES (?, ?, ?, ?)",
).run(1, "+15551234567", "iMessage", "us");

db.query(
  "INSERT INTO handle (ROWID, id, service, country) VALUES (?, ?, ?, ?)",
).run(2, "+15559876543", "SMS", "us");

db.query(
  "INSERT INTO handle (ROWID, id, service, country) VALUES (?, ?, ?, ?)",
).run(3, "alice@example.com", "iMessage", null);

// ============================================================================
// Chats
// ============================================================================

// Chat 1: DM with phone contact (iMessage) — style 45 = DM
db.query(
  `INSERT INTO chat (ROWID, guid, style, chat_identifier, service_name, display_name)
   VALUES (?, ?, ?, ?, ?, ?)`,
).run(1, "iMessage;-;+15551234567", 45, "+15551234567", "iMessage", null);

// Chat 2: DM with email contact (iMessage)
db.query(
  `INSERT INTO chat (ROWID, guid, style, chat_identifier, service_name, display_name)
   VALUES (?, ?, ?, ?, ?, ?)`,
).run(
  2,
  "iMessage;-;alice@example.com",
  45,
  "alice@example.com",
  "iMessage",
  null,
);

// Chat 3: Group chat (iMessage) — style 43 = group
db.query(
  `INSERT INTO chat (ROWID, guid, style, chat_identifier, service_name, display_name, room_name)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(
  3,
  "iMessage;+;chat123456789",
  43,
  "chat123456789",
  "iMessage",
  "Weekend Plans",
  "chat123456789",
);

// ============================================================================
// Chat-Handle joins (participants)
// ============================================================================

// Chat 1: just handle 1
db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)").run(
  1,
  1,
);

// Chat 2: just handle 3
db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)").run(
  2,
  3,
);

// Chat 3: group with handles 1, 2, 3
db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)").run(
  3,
  1,
);
db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)").run(
  3,
  2,
);
db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)").run(
  3,
  3,
);

// ============================================================================
// Helper to build a simple NSArchiver-encoded attributedBody blob
// ============================================================================

function buildAttributedBody(text: string): Buffer {
  // Minimal NSArchiver encoding of NSMutableAttributedString
  // This creates a binary blob that our extractTextFromAttributedBody can parse.
  const textBuf = Buffer.from(text, "utf-8");
  const textLen = textBuf.length;

  // Build the length encoding
  let lengthBytes: Buffer;
  if (textLen < 0x80) {
    lengthBytes = Buffer.from([textLen]);
  } else if (textLen <= 0xffff) {
    lengthBytes = Buffer.alloc(3);
    lengthBytes[0] = 0x81;
    lengthBytes.writeUInt16LE(textLen, 1);
  } else {
    lengthBytes = Buffer.alloc(5);
    lengthBytes[0] = 0x83;
    lengthBytes.writeUInt32LE(textLen, 1);
  }

  // NSArchiver header + NSString marker + header pattern + length + text
  const header = Buffer.from([
    0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, // "bplist" prefix (filler)
    0x00, 0x00, 0x00, 0x00, // padding
  ]);
  const nsString = Buffer.from("NSString");
  const pattern = Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]); // \x01 <byte> \x84 \x01 +

  return Buffer.concat([header, nsString, pattern, lengthBytes, textBuf]);
}

// ============================================================================
// Messages
// ============================================================================

let msgId = 1;

function insertMessage(opts: {
  chatId: number;
  text: string | null;
  attributedBody?: Buffer | null;
  handleId: number;
  isFromMe: boolean;
  date: Date;
  dateRead?: Date | null;
  service: string;
  isAudioMessage?: boolean;
  hasAttachments?: boolean;
  threadOriginatorGuid?: string | null;
  replyToGuid?: string | null;
}): number {
  const id = msgId++;
  const guid = `msg-guid-${id}`;
  const dateNanos = toMacNanos(opts.date);
  const dateReadNanos = opts.dateRead ? toMacNanos(opts.dateRead) : null;

  db.query(
    `INSERT INTO message
     (ROWID, guid, text, attributedBody, handle_id, is_from_me, date, date_read,
      service, is_audio_message, cache_has_attachments, thread_originator_guid, reply_to_guid,
      is_finished, is_sent, is_delivered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    guid,
    opts.text,
    opts.attributedBody ?? null,
    opts.handleId,
    opts.isFromMe ? 1 : 0,
    dateNanos,
    dateReadNanos,
    opts.service,
    opts.isAudioMessage ? 1 : 0,
    opts.hasAttachments ? 1 : 0,
    opts.threadOriginatorGuid ?? null,
    opts.replyToGuid ?? null,
    opts.isFromMe ? 1 : 0,
    opts.isFromMe ? 0 : 1,
  );

  // Join to chat
  db.query(
    "INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)",
  ).run(opts.chatId, id, dateNanos);

  return id;
}

// --- Chat 1: DM with +15551234567 (iMessage) ---

insertMessage({
  chatId: 1,
  text: "Hey, how are you?",
  handleId: 1,
  isFromMe: false,
  date: lastWeek,
  service: "iMessage",
});

insertMessage({
  chatId: 1,
  text: "I'm doing great, thanks!",
  handleId: 0,
  isFromMe: true,
  date: lastWeek,
  service: "iMessage",
});

insertMessage({
  chatId: 1,
  text: "Want to grab lunch tomorrow?",
  handleId: 1,
  isFromMe: false,
  date: yesterday,
  dateRead: yesterday,
  service: "iMessage",
});

insertMessage({
  chatId: 1,
  text: "Sure, sounds good!",
  handleId: 0,
  isFromMe: true,
  date: yesterday,
  service: "iMessage",
});

insertMessage({
  chatId: 1,
  text: "See you at noon 🍕",
  handleId: 1,
  isFromMe: false,
  date: twoHoursAgo,
  service: "iMessage",
});

// --- Chat 2: DM with alice@example.com (iMessage) ---

// Message with attributedBody only (no text column)
insertMessage({
  chatId: 2,
  text: null,
  attributedBody: buildAttributedBody("Check out this cool project!"),
  handleId: 3,
  isFromMe: false,
  date: lastMonth,
  service: "iMessage",
});

insertMessage({
  chatId: 2,
  text: "That looks awesome!",
  handleId: 0,
  isFromMe: true,
  date: lastMonth,
  service: "iMessage",
});

insertMessage({
  chatId: 2,
  text: "Can you send me the link?",
  handleId: 0,
  isFromMe: true,
  date: lastWeek,
  service: "iMessage",
});

// Message with attachment
const msgWithAttachment = insertMessage({
  chatId: 2,
  text: "Here's the screenshot",
  handleId: 3,
  isFromMe: false,
  date: yesterday,
  service: "iMessage",
  hasAttachments: true,
});

// --- Chat 3: Group chat "Weekend Plans" ---

insertMessage({
  chatId: 3,
  text: "Who's free this Saturday?",
  handleId: 0,
  isFromMe: true,
  date: yesterday,
  service: "iMessage",
});

insertMessage({
  chatId: 3,
  text: "I'm in!",
  handleId: 1,
  isFromMe: false,
  date: yesterday,
  service: "iMessage",
});

// SMS message in group
insertMessage({
  chatId: 3,
  text: "Count me in too",
  handleId: 2,
  isFromMe: false,
  date: oneHourAgo,
  service: "SMS",
});

// Thread reply
const originatorGuid = "msg-guid-10"; // "Who's free this Saturday?"
insertMessage({
  chatId: 3,
  text: "What time works for everyone?",
  handleId: 3,
  isFromMe: false,
  date: oneHourAgo,
  service: "iMessage",
  threadOriginatorGuid: originatorGuid,
});

// Audio message
insertMessage({
  chatId: 3,
  text: null,
  attributedBody: buildAttributedBody("\u{FFFD}"),
  handleId: 1,
  isFromMe: false,
  date: now,
  service: "iMessage",
  isAudioMessage: true,
});

// Message with attachment in group
const groupAttachMsg = insertMessage({
  chatId: 3,
  text: "Here's a photo of the venue",
  handleId: 0,
  isFromMe: true,
  date: now,
  service: "iMessage",
  hasAttachments: true,
});

// ============================================================================
// Attachments
// ============================================================================

db.query(
  `INSERT INTO attachment
   (ROWID, guid, filename, mime_type, uti, transfer_name, total_bytes, original_guid)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  1,
  "att-guid-1",
  "~/Library/Messages/Attachments/screenshot.png",
  "image/png",
  "public.png",
  "screenshot.png",
  524288,
  "att-orig-1",
);

db.query(
  "INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)",
).run(msgWithAttachment, 1);

db.query(
  `INSERT INTO attachment
   (ROWID, guid, filename, mime_type, uti, transfer_name, total_bytes, original_guid)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  2,
  "att-guid-2",
  "~/Library/Messages/Attachments/venue.jpg",
  "image/jpeg",
  "public.jpeg",
  "venue.jpg",
  1048576,
  "att-orig-2",
);

db.query(
  "INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)",
).run(groupAttachMsg, 2);

// ============================================================================
// Done
// ============================================================================

db.close();
console.log(`Created test Messages database at ${DB_PATH}`);
console.log(`Messages created: ${msgId - 1}`);
console.log("Handles: +15551234567, +15559876543, alice@example.com");
console.log("Chats: 2 DMs + 1 group (Weekend Plans)");
