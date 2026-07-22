# CLAUDE.md

## Project

macos-ts — TypeScript package for accessing macOS data (Notes, Photos, iMessage, Contacts) via direct SQLite access (no AppleScript). Currently supports Apple Notes, Apple Messages (iMessage/SMS), Apple Contacts, and Apple Photos.

## Commands

- `bun test` — Run all tests (against fixture DB, no Full Disk Access needed)
- `bun run bench` — Hand-time key read paths against the test fixtures (Bun.nanoseconds)
- `bun run lint` — TypeScript type checking + Biome linting/format checking
- `bun run format` — Auto-fix lint issues and reformat with Biome
- `bun run mcp` — Start the stdio MCP server (requires Full Disk Access)
- `bun tui` — Interactive TUI for browsing and reading notes (requires Full Disk Access)
- `bun run create-fixture` — Regenerate the Notes test fixture database
- `bun run tests/fixtures/create-messages-db.ts` — Regenerate the Messages test fixture database
- `bun run tests/fixtures/create-contacts-db.ts` — Regenerate the Contacts test fixture database
- `bun run tests/fixtures/create-photos-db.ts` — Regenerate the Photos test fixture database

## Architecture

- **Runtime**: Bun (uses bun:sqlite, node:zlib built-ins)
- **Access method**: Read-only SQLite against macOS databases
- **No AppleScript for reads** — all *reading* is through the database. The one exception is `Messages.send()` (sending a message), which has no DB path and must drive Messages.app via AppleScript/osascript (see the Messages write-path note below)
- **Structure**: Each data source lives in its own `src/<source>/` directory (e.g. `src/notes/`)
- **Note content**: Stored as gzip-compressed protobuf in `ZICNOTEDATA.ZDATA`, decoded via protobufjs
- **Markdown conversion**: Custom converter walks protobuf AttributeRun entries to emit markdown
- **Entity types**: Discovered at runtime from `Z_PRIMARYKEY` table (ICAccount, ICFolder, ICNote, ICAttachment)
- **Mac timestamps (Notes)**: Seconds since 2001-01-01 (add 978307200 for Unix epoch)
- **Notes attachments**: `listAttachments(noteId)` filters out inline ZTYPEUTI values (`com.apple.notes.table`, `com.apple.notes.gallery`, `public.url`, and any `com.apple.notes.inlinetextattachment.*`) and handwritten drawing UTIs (`isDrawingAttachment`) by default since they have no useful on-disk file path via the usual Media lookup (drawings use `listDrawings` / `readWithHandwriting` instead). Pass `{ includeInlineAttachments: true }` to opt in to inline rows (tables, URL chips, etc.) — drawings are still excluded. Helper `isFileBackedAttachment(contentType)` is exported for advanced consumers (defined in `src/notes/attachments/content-types.ts`).
- **Handwriting (Apple Pencil / PencilKit)**: drawing attachments matched by `isDrawingAttachment` (`DRAWING_ATTACHMENT_TYPES` in `content-types.ts`) — macOS 26 uses `com.apple.paper` (exact match, not `com.apple.paper.doc.*`); older macOS uses `com.apple.drawing*`. No stroke decoding or OCR; surface Apple's pre-rendered PNG from `Accounts/<acct>/FallbackImages/` (only after opening the note locally — iCloud-only/purged → unavailable). API: `listDrawings`, `getDrawingImage`, `readWithHandwriting` (scatter-gather: missing drawings set `available: false` + `error`). MCP `read_note_handwriting` returns markdown JSON plus image blocks via `wrapToolWithImages`. Resolver details: `indexImagesByBasename` in `attachments/resolver.ts`; helpers in `src/notes/handwriting/`.
- **Messages database**: `~/Library/Messages/chat.db` — standard relational schema (handle, chat, message, attachment tables joined via junction tables)
- **Mac timestamps (Messages)**: Nanoseconds since 2001-01-01 (divide by 1e9, then add 978307200 for Unix epoch)
- **Message text**: Stored in `text` column, or as NSArchiver-encoded `attributedBody` blob when rich text
- **Sending messages (the lone write path)**: `Messages.send({ text, handle | chatId, service? })` is the only non-read-only operation in the package. `chat.db` is a passive log — writing to it transmits nothing — so sending drives Messages.app via Apple Events: `Bun.spawnSync(["osascript", "-e", SEND_APPLESCRIPT, target, text, service, mode])`. **AppleScript, not JXA**: on macOS 26 the JXA bridge to Messages is broken (`Application("Messages").services()` throws "Application isn't running" even when it is). The AppleScript form resolves `1st service whose service type is iMessage|SMS` then `participant <handle>`, or `chat id <guid>` for chat mode. User data (recipient, body) is passed as **argv** bound to `on run {target, body, kind, mode}`, never interpolated into the script, to avoid injection. Logic lives in `src/messages/send.ts`: `buildSendArgs` (pure validation, fixture-testable) and `classifySendError` (maps osascript failures — TCC error `-1743`/"Not authorized" → `MessageSendError` with `category: access_denied`). The AppleScript recipient-resolution itself can't be fixture-tested and must be verified on a real Mac (validated end-to-end on macOS 26.3). Messages.app must be running; first send triggers a macOS **Automation** TCC prompt; there is **no delivery confirmation** (exit 0 ≠ delivered). MCP tool `send_message` uses `writeAnnotations` (in `src/mcp-helpers.ts`), not `readOnlyAnnotations`.
- **Contacts database**: Apple stores contacts in per-account source databases at `~/Library/Application Support/AddressBook/Sources/<UUID>/AddressBook-v22.abcddb`. The root `AddressBook-v22.abcddb` is typically empty. The connection logic auto-discovers the source DB with the most contacts. Core Data schema with ZABCDRECORD as the main table
- **Contacts entity types**: Z_ENT=22 for contacts, Z_ENT=19 for groups (from Z_PRIMARYKEY table)
- **Contact details**: Stored in separate tables (ZABCDEMAILADDRESS, ZABCDPHONENUMBER, ZABCDPOSTALADDRESS, etc.) with ZOWNER FK to ZABCDRECORD.Z_PK
- **Search enrichment**: `search()` / `search_contacts` returns the `ContactSummary` type — the lean `Contact` summary plus `phones` and `emails` arrays (the two contact methods people search for), fetched via two batched `..._FOR_OWNERS` queries (`reader.ts` `enrichWithContactMethods`) after the groupId filter + limit slice, so only returned rows are enriched. The broad `list_contacts` / `list_group_members` paths stay lean (`Contact`, no phones/emails). Full detail (addresses, social, notes, etc.) still requires `getContact`
- **Mac timestamps (Contacts)**: Seconds since 2001-01-01 (same as Notes, uses macTimeToDate/dateToMacTime)
- **Contact labels**: Apple stores built-in labels as `_$!<Label>!$_` — cleaned to plain strings by the reader
- **Group membership**: Z_22PARENTGROUPS junction table (Z_22CONTACTS → contact PK, Z_19PARENTGROUPS1 → group PK)
- **Photos database**: `~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite` — Core Data SQLite schema
- **Photos main table**: ZASSET holds every photo/video: ZFILENAME, ZKIND (0=photo, 1=video), dimensions, dates, GPS, ZFAVORITE, ZHIDDEN, ZTRASHEDSTATE
- **Photos metadata**: ZADDITIONALASSETATTRIBUTES joins via ZASSET FK — stores original filename, title, file size, camera info
- **Photos albums**: ZGENERICALBUM table — ZKIND=2 user album, ZKIND=4000 smart album, ZKIND=3571-3573 system (skipped)
- **Album membership**: Z_33ASSETS junction table (Z_33ALBUMS → album PK, Z_3ASSETS → asset PK)
- **Photos file availability**: ZINTERNALRESOURCE table — ZLOCALAVAILABILITY=1 means on disk, otherwise iCloud-only
- **Photos file path resolution**: Originals at `<library>/originals/<first-char-of-ZDIRECTORY>/<ZFILENAME>`. Syndicated / "Shared with You" assets (`ZASSET.ZBUNDLESCOPE=3`) live under `<library>/scopes/syndication/originals/<bucket>/<filename>` instead. `ZBUNDLESCOPE=1` and `2` are not yet investigated and currently fall through to `originals/`
- **Photos visibility filters**: Always filter `ZTRASHEDSTATE=0 AND ZVISIBILITYSTATE=0`; hidden photos excluded by default
- **Mac timestamps (Photos)**: Seconds since 2001-01-01 (same as Notes, uses macTimeToDate/dateToMacTime)
- **Date filters (`listPhotos`/`listNotes`)**: `afterDate`/`beforeDate` filter on capture date (`ZDATECREATED`, photos only). `modifiedAfter` is a separate, deliberately **over-inclusive** incremental-read filter: photos match `ZMODIFICATIONDATE >= T OR ZADDEDDATE >= T`; notes match `modifiedAt >= T OR createdAt >= T` (the OR also catches iCloud items whose modification date was stamped on another device). Never under-include — a backup consumer treats a false negative as data loss. Contacts is intentionally excluded (its `ZMODIFICATIONDATE` isn't bumped when a child phone/email/address row changes)

## Key Files

- `src/index.ts` — Package barrel export
- `src/errors.ts` — Base `MacOSError` class and shared errors (DatabaseNotFoundError, DatabaseAccessDeniedError)
- `src/mcp-server.ts` — Slim MCP server orchestrator (creates instances, registers tools from feature modules)
- `src/mcp-helpers.ts` — Shared MCP helpers (wrapTool, wrapToolWithImages, toolError, readOnlyAnnotations, McpServerInstance type)
- `src/notes/notes.ts` — Main `Notes` class (public API for Apple Notes)
- `src/notes/index.ts` — Notes barrel export
- `src/notes/types.ts` — TypeScript type definitions for Notes
- `src/notes/errors.ts` — Notes-specific errors (NoteNotFoundError, PasswordProtectedError)
- `src/notes/mcp-tools.ts` — Notes MCP tool registrations and capability constant
- `src/notes/protobuf/notestore.proto` — Reverse-engineered protobuf schema
- `src/notes/protobuf/decode.ts` — Gzip decompress + protobuf decode
- `src/notes/conversion/proto-to-markdown.ts` — AttributeRun[] → markdown
- `src/notes/database/connection.ts` — SQLite database connection setup
- `src/notes/database/queries.ts` — SQL queries and Mac time conversion
- `src/notes/database/reader.ts` — SQLite query execution and row mapping
- `src/notes/attachments/resolver.ts` — Attachment file URL resolution (indexes Media/FallbackPDFs by dir name; FallbackImages by file basename or UUID dir name → first inner file, covering flat and nested layouts)
- `src/notes/attachments/content-types.ts` — Attachment UTI classification (`isFileBackedAttachment`, `isDrawingAttachment`, `DRAWING_ATTACHMENT_TYPES`)
- `src/notes/handwriting/drawings.ts` — Pure `collectDrawingRuns(decoded)` — finds drawing attachment runs in a decoded note
- `src/notes/handwriting/image.ts` — `loadImageBase64(path)` + inline size cap; drawings are PNG bytes reported as `image/png`
- `src/messages/messages.ts` — Main `Messages` class (public API for iMessage/SMS)
- `src/messages/index.ts` — Messages barrel export
- `src/messages/types.ts` — TypeScript type definitions for Messages
- `src/messages/errors.ts` — Messages-specific errors (ChatNotFoundError, MessageNotFoundError)
- `src/messages/mcp-tools.ts` — Messages MCP tool registrations and capability constant
- `src/messages/database/connection.ts` — Messages SQLite database connection
- `src/messages/database/queries.ts` — Messages SQL queries and nanosecond time conversion
- `src/messages/database/reader.ts` — Messages query execution, row mapping, and attributedBody decoding
- `src/messages/send.ts` — Send-message logic: `SEND_APPLESCRIPT` script, `buildSendArgs` (validation/arg resolution), `classifySendError` (osascript failure → `MessageSendError`)
- `src/contacts/contacts.ts` — Main `Contacts` class (public API for Apple Contacts)
- `src/contacts/index.ts` — Contacts barrel export
- `src/contacts/types.ts` — TypeScript type definitions for Contacts
- `src/contacts/errors.ts` — Contacts-specific errors (ContactNotFoundError, GroupNotFoundError)
- `src/contacts/mcp-tools.ts` — Contacts MCP tool registrations and capability constant
- `src/contacts/database/connection.ts` — Contacts SQLite database connection
- `src/contacts/database/queries.ts` — Contacts SQL queries and Mac time re-exports
- `src/contacts/database/reader.ts` — Contacts query execution, row mapping, label cleaning
- `tui.ts` — Slim TUI orchestrator (state, tab bar, input dispatch, main init)
- `tui/helpers.ts` — Shared TUI utilities (terminal codes, layout, state types, DRY helpers)
- `tui/notes.ts` — Notes TUI (folder tree, actions, drawing, input, search)
- `tui/messages.ts` — Messages TUI (actions, drawing, input, search, message formatting)
- `tui/contacts.ts` — Contacts TUI (actions, drawing, input, search, contact detail rendering)
- `src/photos/photos.ts` — Main `Photos` class (public API for Apple Photos)
- `src/photos/index.ts` — Photos barrel export
- `src/photos/types.ts` — TypeScript type definitions for Photos
- `src/photos/errors.ts` — Photos-specific errors (PhotoNotFoundError, AlbumNotFoundError)
- `src/photos/mcp-tools.ts` — Photos MCP tool registrations and capability constant
- `src/photos/database/connection.ts` — Photos SQLite database connection
- `src/photos/database/queries.ts` — Photos SQL queries and Mac time re-exports
- `src/photos/database/reader.ts` — Photos query execution, row mapping, file path resolution
- `tui/photos.ts` — Photos TUI (albums, photo list, detail view, search)
- `tests/fixtures/create-test-db.ts` — Generates the test NoteStore.sqlite
- `tests/fixtures/create-messages-db.ts` — Generates the test chat.db
- `tests/fixtures/create-contacts-db.ts` — Generates the test AddressBook-v22.abcddb
- `tests/fixtures/create-photos-db.ts` — Generates the test Photos.sqlite

## Style Type Values (ParagraphStyle.style_type)

- -1 = Body (default)
- 0 = Title
- 1 = Heading
- 2 = Subheading
- 4 = Monospaced (code block)
- 100 = Dotted list (bullet)
- 101 = Dashed list
- 102 = Numbered list
- 103 = Checkbox/checklist

## Font Weight Values (AttributeRun.font_weight)

- 1 = Bold
- 2 = Italic
- 3 = Bold + Italic

## MCP Tool Design Patterns (PATs Framework)

Reference: [Patterns for Agentic Tools](https://arcade.dev/patterns/llm.txt)

When adding or modifying MCP tools in `src/<feature>/mcp-tools.ts`, follow these patterns:

### Tool Classification

- **Query Tool**: Read-only, safe to retry, cacheable, parallelizable (all our tools are this type)
- **Command Tool**: Has side effects; document irreversibility clearly
- **Discovery Tool**: Reveals available operations, schema, capabilities

### Tool Interface

- **Descriptions**: Include prerequisites ("Requires a noteId from list_notes") and follow-ups ("Use read_note to get full content") directly in the description string
- **Constrained Input**: Use enums, ranges, patterns via zod instead of free-form strings
- **Smart Defaults**: Reduce required parameters with sensible defaults
- **Natural Identifier**: Accept human-friendly identifiers (names, emails) and resolve internally, not just numeric IDs
- **Parameter Coercion**: Accept flexible input formats (ISO dates, relative dates, string or number)

### Tool Annotations

Every tool should include MCP `annotations`:

```typescript
annotations: {
  title: "Short human label",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
```

### Error Handling (Error-Guided Recovery)

Errors should teach, not just fail. Every error response should include:

- `error`: machine-readable error name
- `message`: human-readable description
- `category`: `"not_found" | "access_denied" | "password_protected" | "invalid_input" | "internal"`
- `retryable`: boolean
- `recovery`: specific actionable step (e.g., "Use list_notes to find valid note IDs")

### Response Design

- **Next Action Hints**: Include `_next` array suggesting follow-up tools with descriptions
- **Token-Efficient**: Include `totalResults` count for list responses so agents don't need to count array items
- **Progressive Detail**: Summary by default, full detail on request
- **Response envelope**: `{ data, totalResults?, _next? }` — wraps raw data with metadata

### Tool Discovery

- Provide a `get_capabilities` tool that lists available data sources and their tools
- Embed dependency hints ("call X before Y") in descriptions and error messages

### Tool Composition

- **Abstraction Ladder**: Provide both granular and higher-level operations
- **Batch Operation**: Accept arrays for bulk reads, return per-item results
- **Scatter-Gather**: Query parallel sources, merge results, handle partial failures

### Security

- **Secret Injection**: Credentials at runtime, never through LLM
- **Permission Gate**: Enforce access control in code before execution
- **Audit Trail**: Log tool invocations with identity, timestamp, duration

## Documentation

When adding a new data source or changing the public API, update **both** `README.md` and `CLAUDE.md`. The README should include: a usage example for the TypeScript API, the MCP tools list, error types, and any new development commands.

## Versioning

Always bump the patch version in `package.json` when making code changes. Use semver: patch for fixes/small changes, minor for new features, major for breaking changes. The auto-release workflow publishes to npm automatically when a new version is detected on main.

## Testing

Notes tests run against `tests/fixtures/NoteStore.sqlite` — a checked-in SQLite database with 16 sample notes covering all formatting types (including a "Sync Edge Note" for `modifiedAfter` over-inclusion and a "Handwritten Note" with one rendered + one unrendered drawing). The fixture is generated by `tests/fixtures/create-test-db.ts`. If you modify the proto schema or add test cases, regenerate with `bun run create-fixture`. Handwriting tests: `tests/notes-handwriting.test.ts`.

Messages tests run against `tests/fixtures/chat.db` — a checked-in SQLite database with 15 messages across 3 chats (2 DMs + 1 group). The fixture is generated by `tests/fixtures/create-messages-db.ts`. It covers regular text, attributedBody-only messages, different services (iMessage/SMS), thread replies, audio messages, and attachments.

Contacts tests run against `tests/fixtures/AddressBook-v22.abcddb` — a checked-in SQLite database with 5 contacts and 2 groups. The fixture is generated by `tests/fixtures/create-contacts-db.ts`. It covers full and minimal contacts, organization-only contacts, multiple detail records per contact, Apple label formats, group membership, and contacts in multiple groups.

Photos tests run against `tests/fixtures/photos-library/database/Photos.sqlite` — a checked-in SQLite database with 10 visible assets (+ 1 trashed) and 3 albums. The fixture is generated by `tests/fixtures/create-photos-db.ts`, which also creates 0-byte placeholder files at `tests/fixtures/photos-library/originals/<bucket>/<filename>` for locally-available assets so `existsSync()` resolves correctly. Syndicated assets get their placeholder under `tests/fixtures/photos-library/scopes/syndication/originals/<bucket>/<filename>`. It covers photos and videos, favorites, hidden assets, iCloud-only photos and videos, GPS coordinates, smart and user albums, album membership, stale Optimize-Storage metadata (`ZLOCALAVAILABILITY=1` with no on-disk file), syndicated "Shared with You" assets (`ZBUNDLESCOPE=3`), and a recently-re-added old asset (`ZADDEDDATE` recent, `ZMODIFICATIONDATE`/`ZDATECREATED` old) that exercises `modifiedAfter` over-inclusion via the added-date branch. Video assets get both a master `ZINTERNALRESOURCE` row (`ZRESOURCETYPE=1`) and a poster row (`ZRESOURCETYPE=0`) with inverse availability so `CHECK_LOCAL_AVAILABILITY` is exercised correctly for videos.

When adding notes to the fixture, the validation in `insertNote()` will catch attribute run length mismatches — the sum of all run lengths must exactly equal the `noteText` length.
