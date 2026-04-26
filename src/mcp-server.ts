#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Contacts, type ContactsOptions } from "./contacts/index.ts";
import {
  contactsCapability,
  registerContactsTools,
} from "./contacts/mcp-tools.ts";
import { readOnlyAnnotations, wrapTool } from "./mcp-helpers.ts";
import { Messages, type MessagesOptions } from "./messages/index.ts";
import {
  messagesCapability,
  registerMessagesTools,
} from "./messages/mcp-tools.ts";
import { Notes, type NotesOptions } from "./notes/index.ts";
import { notesCapability, registerNotesTools } from "./notes/mcp-tools.ts";
import { Photos, type PhotosOptions } from "./photos/index.ts";
import { photosCapability, registerPhotosTools } from "./photos/mcp-tools.ts";

export interface ServerOptions {
  notes?: NotesOptions;
  messages?: MessagesOptions;
  contacts?: ContactsOptions;
  photos?: PhotosOptions;
}

export function createServer(options?: ServerOptions) {
  const notes = new Notes(options?.notes);
  const messages = new Messages(options?.messages);
  const contacts = new Contacts(options?.contacts);
  const photos = new Photos(options?.photos);

  const server = new McpServer({
    name: "macos",
    version: "0.9.0",
  });

  // Discovery tool — aggregates capabilities from all features
  server.registerTool(
    "get_capabilities",
    {
      title: "Get server capabilities",
      description:
        "Discover available data sources and their tools. Call this first to understand what macOS data this server can access and which tool to start with.",
      annotations: readOnlyAnnotations,
    },
    async () =>
      wrapTool(() => ({
        dataSources: [
          notesCapability,
          messagesCapability,
          contactsCapability,
          photosCapability,
        ],
        allToolsReadOnly: true,
        requirement: "Full Disk Access permission for the terminal app",
      })),
  );

  registerNotesTools(server, notes);
  registerMessagesTools(server, messages);
  registerContactsTools(server, contacts);
  registerPhotosTools(server, photos);

  return { server, notes, messages, contacts, photos };
}

if (import.meta.main) {
  const { server, notes, messages, contacts, photos } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("beforeExit", () => {
    notes.close();
    messages.close();
    contacts.close();
    photos.close();
  });
}
