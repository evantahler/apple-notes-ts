# macos-ts

TypeScript package for accessing macOS data via direct SQLite access — no AppleScript, no network calls. Currently supports **Apple Notes** with Photos and iMessage coming soon.

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
const attachments = db.listAttachments(noteId);
const url = db.getAttachmentUrl("attachment-uuid"); // file:// URL or null

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

- **list_accounts** — List all Apple Notes accounts on this Mac
- **list_folders** — List folders, optionally filtered by account
- **list_notes** — List notes with optional filtering (folder, account, text search), sorting (title, createdAt, modifiedAt), and limit
- **search_notes** — Search notes by title and content
- **read_note** — Read a note as markdown (supports pagination)
- **list_attachments** — List attachments for a note
- **get_attachment_url** — Get the file URL for an attachment

## API

Pass `dbPath` or `containerPath` to `new Notes()` to override auto-detection. Note content is returned as markdown — see [docs/markdown-conversion.md](docs/markdown-conversion.md) for the full formatting map.

Errors: `DatabaseNotFoundError` (missing DB or no Full Disk Access), `NoteNotFoundError`, `PasswordProtectedError` (locked notes can't be decrypted).

## Development

```bash
bun test              # Run test suite
bun run lint          # TypeScript type checking + Biome lint
bun run mcp           # Start the MCP stdio server
bun tui               # Interactive TUI for browsing and reading notes
bun run create-fixture # Regenerate the test fixture database
```

Tests run against a checked-in fixture database — no Full Disk Access needed.

## Limitations

- **Read-only** — writing to SQLite databases directly risks iCloud sync corruption
- **Password-protected notes** — cannot be decrypted; throws `PasswordProtectedError`

## License

MIT
