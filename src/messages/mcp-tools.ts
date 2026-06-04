import { z } from "zod";
import {
  type McpServerInstance,
  readOnlyAnnotations,
  wrapTool,
  writeAnnotations,
} from "../mcp-helpers.ts";
import type { Messages } from "./messages.ts";

export const messagesCapability = {
  name: "iMessage / SMS",
  description:
    "Read iMessage and SMS conversations on this Mac, and send new messages",
  tools: [
    "list_chats",
    "get_chat",
    "list_messages",
    "get_message",
    "search_messages",
    "list_message_attachments",
    "list_handles",
    "send_message",
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
        "List all known contact handles (phone numbers, email addresses) from iMessage/SMS. Returns identifier (phone/email), service type (iMessage/SMS), and numeric ID. Useful for identifying senders in message results. If the Apple Contacts data source is available, pass a handle's identifier to search_contacts to resolve it to a real person (name, organization, other contact details).",
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
          {
            tool: "search_contacts",
            description:
              "Resolve a handle (phone/email) to a contact in Apple Contacts, if available",
          },
        ],
      ),
  );

  server.registerTool(
    "list_chats",
    {
      title: "List conversations",
      description:
        "List iMessage/SMS conversations with display names, participants, service type, and last message date. Supports search by name or phone number. Follow-up: use list_messages with a chatId to read the conversation. Participants are identified by handle (phone/email); if the Apple Contacts data source is available, pass a handle to search_contacts to resolve it to a real person.",
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
          {
            tool: "search_contacts",
            description:
              "Resolve a participant handle (phone/email) to a contact in Apple Contacts, if available",
          },
        ],
      ),
  );

  server.registerTool(
    "get_chat",
    {
      title: "Get conversation details",
      description:
        "Get details for a specific conversation. Requires a chatId from list_chats. Returns participants and metadata. Follow-up: use list_messages to read messages. Participants are identified by handle (phone/email); if the Apple Contacts data source is available, pass a handle to search_contacts to resolve it to a real person.",
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
          {
            tool: "search_contacts",
            description:
              "Resolve a participant handle (phone/email) to a contact in Apple Contacts, if available",
          },
        ],
      ),
  );

  server.registerTool(
    "list_messages",
    {
      title: "List messages",
      description:
        "List messages in a conversation. Requires a chatId from list_chats. Supports date filtering (ISO 8601), direction filtering (fromMe), and limiting. Follow-up: use get_message for details or list_message_attachments for media. Senders are identified by handle (phone/email); if the Apple Contacts data source is available, pass a sender's handle to search_contacts to resolve it to a real person.",
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
          {
            tool: "search_contacts",
            description:
              "Resolve a sender handle (phone/email) to a contact in Apple Contacts, if available",
          },
        ],
      ),
  );

  server.registerTool(
    "get_message",
    {
      title: "Get message",
      description:
        "Get a single message by ID (from list_messages or search_messages). Returns full text, sender, date, and metadata. Follow-up: use list_message_attachments for attached media. The sender is identified by handle (phone/email); if the Apple Contacts data source is available, pass the handle to search_contacts to resolve it to a real person.",
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
          {
            tool: "search_contacts",
            description:
              "Resolve the sender handle (phone/email) to a contact in Apple Contacts, if available",
          },
        ],
      ),
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search messages",
      description:
        "Search message text across all conversations or within a specific chat (chatId from list_chats). Follow-up: use get_message or list_message_attachments with a messageId. Senders are identified by handle (phone/email); if the Apple Contacts data source is available, pass a sender's handle to search_contacts to resolve it to a real person.",
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
        [
          { tool: "get_message", description: "Get full message details" },
          {
            tool: "search_contacts",
            description:
              "Resolve a sender handle (phone/email) to a contact in Apple Contacts, if available",
          },
        ],
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

  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description:
        "Send a new text message (iMessage or SMS) via Messages.app — text someone by phone number or email. This actually delivers a real message and CANNOT be undone — confirm the recipient and text first. Target either an existing conversation by chatId (from list_chats) or a raw handle (phone number or email); provide exactly one. When sending by chatId the service is taken from the chat; when sending by handle it defaults to iMessage (set service to 'SMS' to force a text). The first send prompts for macOS Automation permission, and macOS gives no delivery confirmation (success means the request was dispatched, not delivered). Follow-up: use list_messages on the chat to confirm it appears.",
      annotations: writeAnnotations,
      inputSchema: {
        text: z
          .string()
          .min(1)
          .describe("The message body to send. Must be non-empty."),
        handle: z
          .string()
          .optional()
          .describe(
            "Recipient phone number or email. Provide this OR chatId, not both.",
          ),
        chatId: z
          .number()
          .int()
          .optional()
          .describe(
            "Numeric chat ID (from list_chats) to send into. Provide this OR handle, not both.",
          ),
        service: z
          .enum(["iMessage", "SMS"])
          .optional()
          .describe(
            "Service to use when sending by handle. Defaults to 'iMessage'. Ignored when chatId is given.",
          ),
      },
    },
    async ({ text, handle, chatId, service }) =>
      wrapTool(
        () => messages.send({ text, handle, chatId, service }),
        [
          {
            tool: "list_messages",
            description: "Read the conversation to confirm the message appears",
          },
        ],
      ),
  );
}
