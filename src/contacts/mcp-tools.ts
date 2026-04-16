import { z } from "zod";
import {
  type McpServerInstance,
  readOnlyAnnotations,
  wrapTool,
} from "../mcp-helpers.ts";
import type { Contacts } from "./contacts.ts";

export const contactsCapability = {
  name: "Apple Contacts",
  description: "Read-only access to Apple Contacts (AddressBook) on this Mac",
  tools: [
    "list_contacts",
    "get_contact",
    "search_contacts",
    "list_groups",
    "list_group_members",
  ],
  startWith: "list_contacts or search_contacts",
};

export function registerContactsTools(
  server: McpServerInstance,
  contacts: Contacts,
): void {
  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description:
        "List contacts from Apple Contacts with filtering, sorting, and limiting. Returns summary metadata (name, org, dates). Supports filtering by group. Follow-up: use get_contact with a contactId for full details (emails, phones, addresses, etc.).",
      annotations: readOnlyAnnotations,
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe(
            "Text to filter contacts by, matched against display name and organization.",
          ),
        sortBy: z
          .enum(["displayName", "createdAt", "modifiedAt"])
          .optional()
          .describe("Field to sort results by. Defaults to 'displayName'."),
        order: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort direction. Defaults to 'asc' (A-Z for names)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of contacts to return."),
        groupId: z
          .number()
          .int()
          .optional()
          .describe(
            "Numeric group ID (from list_groups) to filter contacts by group membership.",
          ),
      },
    },
    async ({ search, sortBy, order, limit, groupId }) =>
      wrapTool(
        () => contacts.contacts({ search, sortBy, order, limit, groupId }),
        [
          {
            tool: "get_contact",
            description: "Get full contact details (emails, phones, etc.)",
          },
        ],
      ),
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get contact details",
      description:
        "Get full details for a contact including emails, phone numbers, addresses, URLs, social profiles, related names, and dates. Requires a contactId from list_contacts or search_contacts.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        contactId: z
          .number()
          .int()
          .describe(
            "Numeric contact ID (from list_contacts or search_contacts results).",
          ),
      },
    },
    async ({ contactId }) => wrapTool(() => contacts.getContact(contactId)),
  );

  server.registerTool(
    "search_contacts",
    {
      title: "Search contacts",
      description:
        "Search contacts by name, organization, phone number, or email address. Returns summary metadata for matches. Follow-up: use get_contact with a contactId for full details.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        query: z
          .string()
          .describe(
            "Text to search for in contact names, organizations, phone numbers, and email addresses.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of results to return. Defaults to 50."),
        groupId: z
          .number()
          .int()
          .optional()
          .describe("Numeric group ID to restrict the search to."),
      },
    },
    async ({ query, limit, groupId }) =>
      wrapTool(
        () => contacts.search(query, { limit, groupId }),
        [
          {
            tool: "get_contact",
            description: "Get full details for a matching contact",
          },
        ],
      ),
  );

  server.registerTool(
    "list_groups",
    {
      title: "List contact groups",
      description:
        "List all contact groups with member counts. Follow-up: use list_group_members to see contacts in a group, or use list_contacts with a groupId to filter.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of groups to return."),
      },
    },
    async ({ limit }) =>
      wrapTool(
        () => contacts.groups({ limit }),
        [
          {
            tool: "list_group_members",
            description: "List contacts in a group",
          },
          {
            tool: "list_contacts",
            description: "Filter contacts by group",
          },
        ],
      ),
  );

  server.registerTool(
    "list_group_members",
    {
      title: "List group members",
      description:
        "List all contacts in a group. Requires a groupId from list_groups. Follow-up: use get_contact with a contactId for full details.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        groupId: z
          .number()
          .int()
          .describe("Numeric group ID (from list_groups results)."),
      },
    },
    async ({ groupId }) =>
      wrapTool(
        () => contacts.groupMembers(groupId),
        [
          {
            tool: "get_contact",
            description: "Get full details for a contact",
          },
        ],
      ),
  );
}
