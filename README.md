# macos-ts

TypeScript package for accessing macOS data via direct SQLite access — reads use no AppleScript and make no network calls. Currently supports **Apple Notes**, **Apple Messages** (iMessage/SMS), **Apple Contacts**, and **Apple Photos**. Sending an iMessage/SMS is the one write operation, and it is the only feature that uses Apple Events (osascript); see [Messages](#messages).

## Requirements

- **macOS** (reads local macOS databases)
- **Bun** runtime
- **Full Disk Access** for the process reading data (System Settings → Privacy & Security → Full Disk Access)

## Install

```bash
bun add macos-ts
```

## Usage

### Notes

```typescript
import { Notes } from "macos-ts";

const db = new Notes();

// List accounts and folders
const accounts = db.accounts();
const folders = db.folders();

// List notes (filter, sort, search, limit)
const allNotes = db.notes();
const workNotes = db.notes({ folder: "Work" });
const recent = db.notes({ search: "meeting", sortBy: "modifiedAt", order: "desc", limit: 10 });

// Incremental reads: notes changed since the last sync. Over-inclusive — matches
// if the modified OR created date is >= the cutoff (the OR also catches iCloud
// notes stamped as modified on another device), so nothing changed is missed.
const changedNotes = db.notes({ modifiedAfter: lastSyncTime });

// Search by title or snippet
const results = db.search("meeting notes");
const filtered = db.search("meeting notes", { folder: "Work", limit: 10 });

// Read a note as markdown
const note = db.read(noteId);
console.log(note.markdown);

// Paginate large notes
const page = db.read(noteId, { offset: 0, limit: 100 });
console.log(page.markdown);      // first 100 lines
console.log(page.hasMore);       // true if more lines follow
console.log(page.totalLines);    // total line count

// Attachments — file-backed only by default (URL chips, hashtags, mentions,
// tables, and galleries live inline in the note body and have no file on disk)
const attachments = db.listAttachments(noteId);
const allAttachments = db.listAttachments(noteId, { includeInlineAttachments: true });
const url = db.getAttachmentUrl("attachment-uuid"); // file:// URL or null

// Or check a content type directly
import { isFileBackedAttachment } from "macos-ts";
isFileBackedAttachment("public.jpeg"); // true
isFileBackedAttachment("public.url");  // false

// Cleanup
db.close();
```

### Messages

```typescript
import { Messages } from "macos-ts";

const db = new Messages();

// List contacts and conversations
const handles = db.handles();
const chats = db.chats();
const recentChats = db.chats({ search: "John", sortBy: "lastMessageDate", order: "desc", limit: 10 });

// Get a specific chat
const chat = db.getChat(chatId);

// List messages in a chat (filter by date, sender, limit)
const msgs = db.messages(chatId);
const recent = db.messages(chatId, { limit: 20, order: "desc" });
const filtered = db.messages(chatId, { afterDate: new Date("2024-01-01"), fromMe: true });

// Get a single message
const msg = db.getMessage(messageId);

// Search across all conversations
const results = db.search("dinner tonight");
const inChat = db.search("dinner tonight", { chatId: 1, limit: 10 });

// Attachments
const attachments = db.attachments(messageId);

// Send a new message (the only write operation in this package).
// Target a raw handle (phone/email)...
db.send({ handle: "+15551234567", text: "On my way!" });
db.send({ handle: "friend@example.com", text: "Hi", service: "SMS" });
// ...or an existing conversation by chatId (service taken from the chat):
db.send({ chatId: 1, text: "Sounds good" });

// Cleanup
db.close();
```

> **Sending requires Apple Events.** `chat.db` is only a passive log, so sending
> a message means driving Messages.app via `osascript` (AppleScript). Consequences:
>
> - **macOS Automation permission** is required — the first `send()` triggers a
>   one-time TCC prompt to allow your terminal/host app to control "Messages".
> - **No delivery confirmation.** A successful return means the request was
>   dispatched, not that it was delivered. Failures throw `MessageSendError`.
> - **Irreversible.** A sent message cannot be unsent.
> - Messages.app must be open and signed in.

### Contacts

```typescript
import { Contacts } from "macos-ts";

const db = new Contacts();

// List all contacts (filter, sort, search, limit)
const allContacts = db.contacts();
const sorted = db.contacts({ sortBy: "modifiedAt", order: "desc", limit: 10 });
const inGroup = db.contacts({ groupId: 1 });

// Search by name, organization, phone number, or email
const results = db.search("John");
const byPhone = db.search("555-1234");
const byEmail = db.search("alice@example.com");

// Get full contact details (emails, phones, addresses, etc.)
const details = db.getContact(contactId);
console.log(details.emails);     // [{ address, label, isPrimary }]
console.log(details.phones);     // [{ number, label, isPrimary }]
console.log(details.addresses);  // [{ street, city, state, zipCode, country, label }]

// Groups
const groups = db.groups();
const members = db.groupMembers(groupId);

// Cleanup
db.close();
```

### Photos

```typescript
import { Photos } from "macos-ts";

const db = new Photos();

// List photos (filter by media type, favorites, date range, album).
// Each result includes modifiedAt + fileSize, so callers can diff against a
// manifest in one query without per-photo getPhoto() / fs.stat() round-trips.
const allPhotos = db.photos();
const favorites = db.photos({ favorite: true });
const videos = db.photos({ mediaType: "video" });
const recent = db.photos({ afterDate: new Date("2024-01-01"), limit: 20 });
const inAlbum = db.photos({ albumId: 1 });

// Incremental reads: everything that CHANGED since the last sync. Use this
// (not afterDate) for backup/sync — see the callout below.
const changed = db.photos({ modifiedAfter: lastSyncTime });

// Get full photo details (dimensions, GPS, file size, iCloud status)
const details = db.getPhoto(photoId);
console.log(details.title);             // "Sunset at the Beach"
console.log(details.locallyAvailable);  // false = iCloud only or purged

// Get file URL for a photo
const { url, locallyAvailable } = db.getPhotoUrl(photoId);
// url: "file:///Users/.../Photos Library.photoslibrary/originals/0/IMG_001.JPG"
// locallyAvailable is filesystem-verified: true means the Photos.sqlite flag
// AND the file actually exists at `url`. Apple's "Optimize Mac Storage" can
// purge files without flipping the flag, so callers can trust this signal
// without an extra stat() check.

// List albums (user and smart albums)
const albums = db.albums();
```

#### `afterDate`/`beforeDate` vs `modifiedAfter`

These filter on **different dates** for **different jobs** — don't confuse them:

| Filter | Date checked | Use it for |
| --- | --- | --- |
| `afterDate` / `beforeDate` | Capture date (`ZDATECREATED`) — when the photo was *taken* | Browsing by when events happened ("my June trip"). A 2020 photo imported today still has a 2020 capture date. |
| `modifiedAfter` | Modification date **OR** library-added date (`ZMODIFICATIONDATE` / `ZADDEDDATE`) | Incremental sync ("what changed since T"). Deliberately **over-inclusive** — matches if *either* date is `>= T`, so a re-imported old photo is still returned and nothing changed is ever missed. |

```typescript
const vacation = db.albums({ search: "vacation" });

// Get album contents (photo IDs)
const album = db.getAlbum(albumId);
console.log(album.photoIds);  // [1, 5, 42, ...]

// Search by filename or title
const results = db.search("sunset");

// Cleanup
db.close();
```

## MCP Server

macos-ts includes a stdio MCP server so AI agents can interact with your macOS data.

### Configure

Add to your MCP client config (e.g., Claude Desktop, Claude Code):

```json
{
  "mcpServers": {
    "macos": {
      "command": "bunx",
      "args": ["macos-ts"]
    }
  }
}
```

### Available Tools

#### Discovery

- **get_capabilities** — Discover available data sources, their tools, and recommended starting points

#### Notes

- **list_accounts** — List all Apple Notes accounts on this Mac
- **list_folders** — List folders, optionally filtered by account
- **list_notes** — List notes with optional filtering (folder, account, text search, `modifiedAfter` for incremental reads), sorting (title, createdAt, modifiedAt), and limit
- **search_notes** — Search notes by title and content
- **read_note** — Read a note as markdown (supports pagination)
- **list_attachments** — List file-backed attachments for a note (set `includeInlineAttachments=true` to also return inline rows like URL chips, hashtags, mentions, tables, and galleries)
- **get_attachment_url** — Get the file URL for an attachment

#### Messages

- **list_handles** — List all known contact handles (phone numbers, email addresses)
- **list_chats** — List iMessage/SMS conversations with optional search, sorting, and limiting
- **get_chat** — Get details for a specific conversation by ID
- **list_messages** — List messages in a conversation with date filtering and pagination
- **get_message** — Get a single message by ID
- **search_messages** — Search message text across all conversations or within a specific chat
- **list_message_attachments** — List attachments for a specific message
- **send_message** — Send a new iMessage/SMS to a handle or chatId (the only write tool; requires macOS Automation permission, gives no delivery confirmation, and cannot be undone)

#### Contacts

- **list_contacts** — List contacts with optional search, sorting (displayName, createdAt, modifiedAt), group filtering, and limit
- **get_contact** — Get full contact details (emails, phones, addresses, URLs, social profiles, related names, dates)
- **search_contacts** — Search contacts by name, organization, phone number, or email address
- **list_groups** — List all contact groups with member counts
- **list_group_members** — List contacts in a specific group

#### Photos

- **list_photos** — List photos/videos with filtering by media type, favorites, capture-date range (`afterDate`/`beforeDate`), `modifiedAfter` (change/added date, for incremental reads), album, and sorting
- **get_photo** — Get full photo metadata (dimensions, GPS, file size, iCloud availability)
- **get_photo_url** — Get the local file:// URL for a photo's original file
- **list_albums** — List user-created and smart albums with photo counts
- **get_album** — Get album details and list of photo IDs
- **search_photos** — Search photos by filename or title

### Tool Response Format

All tools return responses in a structured envelope:

```json
{
  "data": [ ... ],
  "totalResults": 42,
  "_next": [
    { "tool": "read_note", "description": "Read a note's full markdown content" }
  ]
}
```

- **data** — The actual result (array or object)
- **totalResults** — Count of items (for array results)
- **_next** — Suggested follow-up tools to call next

Error responses include structured recovery guidance:

```json
{
  "error": "NoteNotFoundError",
  "message": "Note not found: 999",
  "category": "not_found",
  "retryable": false,
  "recovery": "Use list_notes or search_notes to find valid note IDs."
}
```

## API

**Notes**: Pass `dbPath` or `containerPath` to `new Notes()` to override auto-detection. Note content is returned as markdown — see [docs/markdown-conversion.md](docs/markdown-conversion.md) for the full formatting map.

Errors: `DatabaseNotFoundError` (missing DB or no Full Disk Access), `NoteNotFoundError`, `PasswordProtectedError` (locked notes can't be decrypted).

**Messages**: Pass `dbPath` to `new Messages()` to override auto-detection (defaults to `~/Library/Messages/chat.db`).

Errors: `DatabaseNotFoundError`, `ChatNotFoundError`, `MessageNotFoundError`, `MessageSendError` (sending failed; `category` is `access_denied` when macOS Automation permission is missing, otherwise `internal`).

**Contacts**: Pass `dbPath` to `new Contacts()` to override auto-detection (defaults to `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb`). Labels are automatically cleaned from Apple's internal `_$!<Label>!$_` format to plain strings (e.g., "Home", "Work", "Mobile").

Errors: `DatabaseNotFoundError`, `ContactNotFoundError`, `GroupNotFoundError`.

**Photos**: Pass `dbPath` to `new Photos()` to override auto-detection (defaults to `~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite`). The `getPhotoUrl` method resolves the original file path and indicates whether the photo is locally available or iCloud-only. `locallyAvailable` is verified against the filesystem — `true` only when the Photos.sqlite flag is set *and* the file is present at the returned URL.

Errors: `DatabaseNotFoundError`, `PhotoNotFoundError`, `AlbumNotFoundError`.

## Development

```bash
bun test              # Run test suite
bun run bench         # Hand-time key read paths against the fixtures
bun run lint          # TypeScript type checking + Biome lint
bun run mcp           # Start the MCP stdio server
bun tui               # Interactive TUI for browsing and reading notes
bun run create-fixture # Regenerate the Notes test fixture database
bun run tests/fixtures/create-messages-db.ts   # Regenerate the Messages test fixture database
bun run tests/fixtures/create-contacts-db.ts   # Regenerate the Contacts test fixture database
bun run tests/fixtures/create-photos-db.ts     # Regenerate the Photos test fixture database
```

Tests run against a checked-in fixture database — no Full Disk Access needed.

## Limitations

- **Read-only** — writing to SQLite databases directly risks iCloud sync corruption
- **Password-protected notes** — cannot be decrypted; throws `PasswordProtectedError`

## License

MIT
