#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MacOSError } from "./errors.ts";
import { Messages, type MessagesOptions } from "./messages/index.ts";
import { Notes, type NotesOptions } from "./notes/index.ts";

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

export interface ServerOptions {
  notes?: NotesOptions;
  messages?: MessagesOptions;
}

export function createServer(options?: ServerOptions) {
  const notes = new Notes(options?.notes);
  const messages = new Messages(options?.messages);

  const server = new McpServer({
    name: "macos",
    version: "0.6.0",
  });

  // ==========================================================================
  // Notes tools
  // ==========================================================================

  server.registerTool(
    "list_accounts",
    {
      description:
        "List all Apple Notes accounts configured on this Mac (e.g. iCloud, On My Mac). Returns each account's numeric ID and display name.",
    },
    async () => {
      try {
        return toolResult(notes.accounts());
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "list_folders",
    {
      description:
        "List Apple Notes folders. Each folder includes its name, note count, and the account it belongs to. Optionally filter to a single account.",
      inputSchema: {
        account: z
          .string()
          .optional()
          .describe(
            "Account name (e.g. 'iCloud') or numeric account ID to filter by.",
          ),
      },
    },
    async ({ account }) => {
      try {
        return toolResult(notes.folders(account));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "list_notes",
    {
      description:
        "List notes with optional filtering, sorting, and limiting. Returns metadata only (title, snippet, dates) — use read_note to get full content.",
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
    async ({ folder, account, search, sortBy, order, limit }) => {
      try {
        return toolResult(
          notes.notes({ folder, account, search, sortBy, order, limit }),
        );
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "search_notes",
    {
      description:
        "Search Apple Notes by matching against note titles and text snippets. Returns metadata for matching notes — use read_note to get full content.",
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
    async ({ query, folder, limit }) => {
      try {
        return toolResult(notes.search(query, { folder, limit }));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "read_note",
    {
      description:
        "Read the full content of an Apple Note as markdown. Supports pagination for large notes — pass offset and limit to read a specific range of lines.",
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
    async ({ noteId, offset, limit }) => {
      try {
        if (offset !== undefined || limit !== undefined) {
          return toolResult(notes.read(noteId, { offset, limit }));
        }
        return toolResult(notes.read(noteId));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "list_attachments",
    {
      description:
        "List all attachments (images, files, etc.) for a specific note. Returns each attachment's name, content type, and local file URL if available.",
      inputSchema: {
        noteId: z
          .number()
          .int()
          .describe("Numeric note ID to get attachments for."),
      },
    },
    async ({ noteId }) => {
      try {
        return toolResult(notes.listAttachments(noteId));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "get_attachment_url",
    {
      description:
        "Resolve a local file:// URL for a specific attachment by its filename. Returns null if the attachment file is not found on disk.",
      inputSchema: {
        name: z
          .string()
          .describe("Attachment filename (from list_attachments results)."),
      },
    },
    async ({ name }) => {
      try {
        return toolResult({ url: notes.getAttachmentUrl(name) });
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  // ==========================================================================
  // Messages tools
  // ==========================================================================

  server.registerTool(
    "list_chats",
    {
      description:
        "List iMessage/SMS conversations. Returns each chat's display name, participants, service type, and last message date. Optionally search by name or phone number.",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe(
            "Text to filter chats by, matched against display name, chat identifier, and participant handles.",
          ),
        sortBy: z
          .enum(["lastMessageDate", "displayName"])
          .optional()
          .describe("Field to sort results by. Defaults to 'lastMessageDate'."),
        order: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort direction. Defaults to 'desc' (newest first)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of chats to return."),
      },
    },
    async ({ search, sortBy, order, limit }) => {
      try {
        return toolResult(messages.chats({ search, sortBy, order, limit }));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "get_chat",
    {
      description:
        "Get details for a specific iMessage/SMS conversation by its numeric ID, including all participants.",
      inputSchema: {
        chatId: z
          .number()
          .int()
          .describe("Numeric chat ID (from list_chats results)."),
      },
    },
    async ({ chatId }) => {
      try {
        return toolResult(messages.getChat(chatId));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "list_messages",
    {
      description:
        "List messages in a specific iMessage/SMS conversation. Supports date filtering and limiting. Returns message text, sender, date, and metadata.",
      inputSchema: {
        chatId: z
          .number()
          .int()
          .describe("Numeric chat ID to get messages for."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe(
            "Maximum number of messages to return. Defaults to all messages.",
          ),
        beforeDate: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date string. Only return messages before this date.",
          ),
        afterDate: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date string. Only return messages after this date.",
          ),
        fromMe: z
          .boolean()
          .optional()
          .describe(
            "Filter to only sent (true) or only received (false) messages.",
          ),
        order: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort direction. Defaults to 'desc' (newest first)."),
      },
    },
    async ({ chatId, limit, beforeDate, afterDate, fromMe, order }) => {
      try {
        return toolResult(
          messages.messages(chatId, {
            limit,
            beforeDate: beforeDate ? new Date(beforeDate) : undefined,
            afterDate: afterDate ? new Date(afterDate) : undefined,
            fromMe,
            order,
          }),
        );
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "get_message",
    {
      description:
        "Get a single iMessage/SMS message by its numeric ID. Returns the full message text, sender, date, and metadata.",
      inputSchema: {
        messageId: z
          .number()
          .int()
          .describe(
            "Numeric message ID (from list_messages or search_messages results).",
          ),
      },
    },
    async ({ messageId }) => {
      try {
        return toolResult(messages.getMessage(messageId));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "search_messages",
    {
      description:
        "Search iMessage/SMS message text across all conversations or within a specific chat. Returns matching messages with sender, date, and chat context.",
      inputSchema: {
        query: z.string().describe("Text to search for in message content."),
        chatId: z
          .number()
          .int()
          .optional()
          .describe("Numeric chat ID to restrict the search to."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of results to return. Defaults to 50."),
      },
    },
    async ({ query, chatId, limit }) => {
      try {
        return toolResult(messages.search(query, { chatId, limit }));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "list_message_attachments",
    {
      description:
        "List all attachments (images, files, etc.) for a specific iMessage/SMS message. Returns filename, MIME type, and file size.",
      inputSchema: {
        messageId: z
          .number()
          .int()
          .describe("Numeric message ID to get attachments for."),
      },
    },
    async ({ messageId }) => {
      try {
        return toolResult(messages.attachments(messageId));
      } catch (e) {
        if (e instanceof MacOSError) return toolError(e.message);
        throw e;
      }
    },
  );

  return { server, notes, messages };
}

if (import.meta.main) {
  const { server, notes, messages } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("beforeExit", () => {
    notes.close();
    messages.close();
  });
}
