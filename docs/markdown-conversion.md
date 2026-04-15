# Markdown Conversion

macos-ts converts Apple Notes content from its internal protobuf format into standard markdown. This document describes the conversion mapping and how the underlying data is accessed.

## Formatting Map

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
