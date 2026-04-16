import { z } from "zod";
import {
  type McpServerInstance,
  readOnlyAnnotations,
  wrapTool,
} from "../mcp-helpers.ts";
import type { Notes } from "./notes.ts";

export const notesCapability = {
  name: "Apple Notes",
  description: "Read-only access to Apple Notes on this Mac",
  tools: [
    "list_accounts",
    "list_folders",
    "list_notes",
    "search_notes",
    "read_note",
    "list_attachments",
    "get_attachment_url",
  ],
  startWith: "list_accounts or list_notes",
};

export function registerNotesTools(
  server: McpServerInstance,
  notes: Notes,
): void {
  server.registerTool(
    "list_accounts",
    {
      title: "List Notes accounts",
      description:
        "List all Apple Notes accounts on this Mac (e.g. iCloud, On My Mac). Returns account IDs and names. Use these to filter list_folders or list_notes.",
      annotations: readOnlyAnnotations,
    },
    async () =>
      wrapTool(
        () => notes.accounts(),
        [
          { tool: "list_folders", description: "List folders for an account" },
          { tool: "list_notes", description: "List notes in an account" },
        ],
      ),
  );

  server.registerTool(
    "list_folders",
    {
      title: "List Notes folders",
      description:
        "List Apple Notes folders with note counts. Optionally filter by account (from list_accounts). Use folder names/IDs to filter list_notes.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        account: z
          .string()
          .optional()
          .describe(
            "Account name (e.g. 'iCloud') or numeric account ID to filter by.",
          ),
      },
    },
    async ({ account }) =>
      wrapTool(
        () => notes.folders(account),
        [{ tool: "list_notes", description: "List notes in a folder" }],
      ),
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List notes with filtering, sorting, and limiting. Returns metadata only (title, snippet, dates). Use list_folders or list_accounts for filter values. Follow-up: use read_note with a noteId to get full markdown content.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        folder: z
          .string()
          .optional()
          .describe(
            "Folder name (e.g. 'Work') or numeric folder ID to filter by.",
          ),
        account: z
          .string()
          .optional()
          .describe(
            "Account name (e.g. 'iCloud') or numeric account ID to filter by.",
          ),
        search: z
          .string()
          .optional()
          .describe(
            "Text to filter notes by, matched case-insensitively against title and snippet.",
          ),
        sortBy: z
          .enum(["title", "createdAt", "modifiedAt"])
          .optional()
          .describe("Field to sort results by. Defaults to 'modifiedAt'."),
        order: z
          .enum(["asc", "desc"])
          .optional()
          .describe(
            "Sort direction. Defaults to 'desc' (newest first for date sorts, Z-A for title).",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of notes to return."),
      },
    },
    async ({ folder, account, search, sortBy, order, limit }) =>
      wrapTool(
        () => notes.notes({ folder, account, search, sortBy, order, limit }),
        [
          {
            tool: "read_note",
            description: "Read a note's full markdown content",
          },
        ],
      ),
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Search Apple Notes by text matching against titles and snippets. Returns metadata for matches. Follow-up: use read_note with a noteId for full content. Tip: use list_notes for browsing without a search term.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        query: z
          .string()
          .describe("Text to search for in note titles and snippets."),
        folder: z
          .string()
          .optional()
          .describe(
            "Folder name or numeric folder ID to restrict the search to.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of results to return. Defaults to 50."),
      },
    },
    async ({ query, folder, limit }) =>
      wrapTool(
        () => notes.search(query, { folder, limit }),
        [{ tool: "read_note", description: "Read a matching note" }],
      ),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note content",
      description:
        "Read the full content of an Apple Note as markdown. Requires a noteId from list_notes or search_notes. Supports pagination via offset/limit for large notes. Follow-up: use list_attachments to see attached files.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        noteId: z
          .number()
          .int()
          .describe(
            "Numeric note ID (from list_notes or search_notes results).",
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Line number to start reading from (0-based). Omit to start from the beginning.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Maximum number of lines to return. Omit to return the entire note. When set, response includes totalLines and hasMore fields.",
          ),
      },
    },
    async ({ noteId, offset, limit }) =>
      wrapTool(() => {
        if (offset !== undefined || limit !== undefined) {
          return notes.read(noteId, { offset, limit });
        }
        return notes.read(noteId);
      }, [
        {
          tool: "list_attachments",
          description: "See attachments for this note",
        },
      ]),
  );

  server.registerTool(
    "list_attachments",
    {
      title: "List note attachments",
      description:
        "List all attachments for a note. Requires a noteId from list_notes or search_notes. Follow-up: use get_attachment_url with a filename to get the local file path.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        noteId: z
          .number()
          .int()
          .describe("Numeric note ID to get attachments for."),
      },
    },
    async ({ noteId }) =>
      wrapTool(
        () => notes.listAttachments(noteId),
        [
          {
            tool: "get_attachment_url",
            description: "Get file path for an attachment",
          },
        ],
      ),
  );

  server.registerTool(
    "get_attachment_url",
    {
      title: "Get attachment URL",
      description:
        "Resolve a local file:// URL for a note attachment by filename (from list_attachments). Returns null if file not found on disk.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        name: z
          .string()
          .describe("Attachment filename (from list_attachments results)."),
      },
    },
    async ({ name }) => wrapTool(() => ({ url: notes.getAttachmentUrl(name) })),
  );
}
