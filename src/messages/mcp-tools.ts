import { z } from "zod";
import {
  type McpServerInstance,
  readOnlyAnnotations,
  wrapTool,
} from "../mcp-helpers.ts";
import type { Messages } from "./messages.ts";

export const messagesCapability = {
  name: "iMessage / SMS",
  description: "Read-only access to iMessage and SMS conversations on this Mac",
  tools: [
    "list_chats",
    "get_chat",
    "list_messages",
    "get_message",
    "search_messages",
    "list_message_attachments",
    "list_handles",
  ],
  startWith: "list_chats or search_messages",
};

export function registerMessagesTools(
  server: McpServerInstance,
  messages: Messages,
): void {
  server.registerTool(
    "list_handles",
    {
      title: "List message handles",
      description:
        "List all known contact handles (phone numbers, email addresses) from iMessage/SMS. Returns identifier (phone/email), service type (iMessage/SMS), and numeric ID. Useful for identifying senders in message results.",
      annotations: readOnlyAnnotations,
    },
    async () =>
      wrapTool(
        () => messages.handles(),
        [
          {
            tool: "list_chats",
            description: "Find conversations with a contact",
          },
        ],
      ),
  );

  server.registerTool(
    "list_chats",
    {
      title: "List conversations",
      description:
        "List iMessage/SMS conversations with display names, participants, service type, and last message date. Supports search by name or phone number. Follow-up: use list_messages with a chatId to read the conversation.",
      annotations: readOnlyAnnotations,
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
    async ({ search, sortBy, order, limit }) =>
      wrapTool(
        () => messages.chats({ search, sortBy, order, limit }),
        [
          {
            tool: "list_messages",
            description: "Read messages in a conversation",
          },
        ],
      ),
  );

  server.registerTool(
    "get_chat",
    {
      title: "Get conversation details",
      description:
        "Get details for a specific conversation. Requires a chatId from list_chats. Returns participants and metadata. Follow-up: use list_messages to read messages.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        chatId: z
          .number()
          .int()
          .describe("Numeric chat ID (from list_chats results)."),
      },
    },
    async ({ chatId }) =>
      wrapTool(
        () => messages.getChat(chatId),
        [
          {
            tool: "list_messages",
            description: "Read messages in this conversation",
          },
        ],
      ),
  );

  server.registerTool(
    "list_messages",
    {
      title: "List messages",
      description:
        "List messages in a conversation. Requires a chatId from list_chats. Supports date filtering (ISO 8601), direction filtering (fromMe), and limiting. Follow-up: use get_message for details or list_message_attachments for media.",
      annotations: readOnlyAnnotations,
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
    async ({ chatId, limit, beforeDate, afterDate, fromMe, order }) =>
      wrapTool(
        () =>
          messages.messages(chatId, {
            limit,
            beforeDate: beforeDate ? new Date(beforeDate) : undefined,
            afterDate: afterDate ? new Date(afterDate) : undefined,
            fromMe,
            order,
          }),
        [
          { tool: "get_message", description: "Get full message details" },
          {
            tool: "list_message_attachments",
            description: "Get attachments for a message",
          },
        ],
      ),
  );

  server.registerTool(
    "get_message",
    {
      title: "Get message",
      description:
        "Get a single message by ID (from list_messages or search_messages). Returns full text, sender, date, and metadata. Follow-up: use list_message_attachments for attached media.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        messageId: z
          .number()
          .int()
          .describe(
            "Numeric message ID (from list_messages or search_messages results).",
          ),
      },
    },
    async ({ messageId }) =>
      wrapTool(
        () => messages.getMessage(messageId),
        [
          {
            tool: "list_message_attachments",
            description: "Get attachments for this message",
          },
        ],
      ),
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search messages",
      description:
        "Search message text across all conversations or within a specific chat (chatId from list_chats). Follow-up: use get_message or list_message_attachments with a messageId.",
      annotations: readOnlyAnnotations,
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
    async ({ query, chatId, limit }) =>
      wrapTool(
        () => messages.search(query, { chatId, limit }),
        [{ tool: "get_message", description: "Get full message details" }],
      ),
  );

  server.registerTool(
    "list_message_attachments",
    {
      title: "List message attachments",
      description:
        "List attachments for a message. Requires a messageId from list_messages or search_messages. Returns filename, MIME type, and file size.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        messageId: z
          .number()
          .int()
          .describe("Numeric message ID to get attachments for."),
      },
    },
    async ({ messageId }) => wrapTool(() => messages.attachments(messageId)),
  );
}
