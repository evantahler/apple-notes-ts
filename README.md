# apple-notes-ts

TypeScript package for reading and searching Apple Notes on macOS. Parses the NoteStore.sqlite database directly — no AppleScript, no network calls. Note content is returned as markdown.

## Requirements

- **macOS** (Apple Notes stores data locally)
- **Bun** runtime
- **Full Disk Access** for the process reading notes (System Settings → Privacy & Security → Full Disk Access)

## Install

```bash
bun add apple-notes-ts
```

## Usage

```typescript
import { AppleNotes } from "apple-notes-ts";

const db = new AppleNotes();

// List accounts and folders
const accounts = db.accounts();
const folders = db.folders();

// List all notes (or filter by folder)
const allNotes = db.notes();
const workNotes = db.notes({ folder: "Work" });

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

// Attachments
const attachments = db.getAttachments(noteId);
const url = db.getAttachmentUrl("attachment-uuid"); // file:// URL or null

// Cleanup
db.close();
```

## API

### `new AppleNotes(options?)`

Opens the NoteStore.sqlite database. Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | `string` | Auto-detected | Path to NoteStore.sqlite |
| `containerPath` | `string` | Auto-detected | Path to Apple Notes container (for attachment resolution) |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `accounts()` | `Account[]` | List all accounts (iCloud, On My Mac, etc.) |
| `folders(account?)` | `Folder[]` | List folders, optionally filtered by account |
| `notes(options?)` | `NoteMeta[]` | List notes, optionally filtered by folder/account |
| `search(query, options?)` | `NoteMeta[]` | Search notes by title and snippet |
| `read(noteId)` | `NoteContent` | Read full note as markdown |
| `read(noteId, { offset, limit })` | `NoteContentPage` | Read paginated note content |
| `getAttachments(noteId)` | `AttachmentRef[]` | Get attachment metadata for a note |
| `getAttachmentUrl(identifier)` | `string \| null` | Resolve attachment UUID to `file://` URL |
| `close()` | `void` | Close the database connection |

### Markdown Conversion

The following Apple Notes formatting is converted to markdown:

| Apple Notes | Markdown |
|-------------|----------|
| Title | `# Title` |
| Heading | `## Heading` |
| Subheading | `### Subheading` |
| Bold | `**bold**` |
| Italic | `*italic*` |
| Bold + Italic | `***both***` |
| Strikethrough | `~~struck~~` |
| Underline | `<u>underline</u>` |
| Code block | `` ``` `` fenced block |
| Inline code | `` `code` `` |
| Bullet list | `- item` |
| Numbered list | `1. item` |
| Checklist | `- [ ]` / `- [x]` |
| Block quote | `> quote` |
| Link | `[text](url)` |
| Attachment | `![attachment](attachment:uuid)` |
| Nested lists | Indented with 2 spaces per level |

### Error Handling

| Error | When |
|-------|------|
| `DatabaseNotFoundError` | NoteStore.sqlite not found or inaccessible (check Full Disk Access) |
| `NoteNotFoundError` | Note ID doesn't exist |
| `PasswordProtectedError` | Note is locked and can't be read |

## How It Works

Apple Notes stores data in a Core Data SQLite database at:

```
~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite
```

Note content is stored as gzip-compressed [Protocol Buffers](https://protobuf.dev/) in the `ZICNOTEDATA.ZDATA` column. This package:

1. Opens the database read-only with `bun:sqlite`
2. Discovers entity types from `Z_PRIMARYKEY` (handles schema variations across macOS versions)
3. Decompresses ZDATA with `node:zlib`
4. Decodes the protobuf using a reverse-engineered `.proto` schema
5. Walks the `AttributeRun` entries to convert formatting to markdown

The protobuf schema is based on research from [apple_cloud_notes_parser](https://github.com/threeplanetssoftware/apple_cloud_notes_parser), [apple-notes-liberator](https://github.com/HamburgChimps/apple-notes-liberator), and [Ciofeca Forensics](https://ciofecaforensics.com/2020/09/18/apple-notes-revisited-protobuf/).

## Development

```bash
bun test              # Run test suite (74 tests)
bun run typecheck     # TypeScript type checking
bun example           # List notes on this machine, display one at random
bun run create-fixture # Regenerate the test fixture database
```

Tests run against a checked-in fixture database — no Full Disk Access needed.

## Limitations

- **Read-only** — writing to the SQLite database directly risks iCloud sync corruption
- **macOS only** — requires the Apple Notes database on disk
- **Full Disk Access required** — the database is protected by macOS TCC
- **Password-protected notes** — cannot be decrypted; throws `PasswordProtectedError`
- **Tables** — embedded tables use a separate CRDT-based protobuf format and are not yet converted to markdown

## License

MIT
