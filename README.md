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

## MCP Server

apple-notes-ts includes a stdio MCP server so AI agents can interact with your notes.

### Configure

Add to your MCP client config (e.g., Claude Desktop, Claude Code):

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "bunx",
      "args": ["apple-notes-ts"]
    }
  }
}
```

### Available Tools

- **list_accounts** — List all Apple Notes accounts on this Mac
- **list_folders** — List folders, optionally filtered by account
- **list_notes** — List notes, optionally filtered by folder/account
- **search_notes** — Search notes by title and content
- **read_note** — Read a note as markdown (supports pagination)
- **get_attachments** — List attachments for a note
- **get_attachment_url** — Get the file URL for an attachment

## API

Pass `dbPath` or `containerPath` to `new AppleNotes()` to override auto-detection. Note content is returned as markdown — see [docs/markdown-conversion.md](docs/markdown-conversion.md) for the full formatting map.

Errors: `DatabaseNotFoundError` (missing DB or no Full Disk Access), `NoteNotFoundError`, `PasswordProtectedError` (locked notes can't be decrypted).

## Development

```bash
bun test              # Run test suite
bun run lint          # TypeScript type checking + Biome lint
bun run mcp           # Start the MCP stdio server
bun example           # List notes on this machine, display one at random
bun run create-fixture # Regenerate the test fixture database
```

Tests run against a checked-in fixture database — no Full Disk Access needed.

## Limitations

- **Read-only** — writing to the SQLite database directly risks iCloud sync corruption
- **Password-protected notes** — cannot be decrypted; throws `PasswordProtectedError`
- **Tables** — embedded tables use a separate CRDT-based protobuf format and are not yet converted to markdown

## License

MIT
