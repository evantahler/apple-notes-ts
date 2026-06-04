import type { Database } from "bun:sqlite";
import { openFullDiskAccessSettings } from "../errors.ts";
import { openDatabase } from "./database/connection.ts";
import { ContactReader } from "./database/reader.ts";
import { ContactNotFoundError, GroupNotFoundError } from "./errors.ts";
import type {
  Contact,
  ContactDetails,
  ContactSummary,
  Group,
  ListContactsOptions,
  ListGroupsOptions,
  SearchContactsOptions,
} from "./types.ts";

export interface ContactsOptions {
  dbPath?: string;
}

export class Contacts {
  private db: Database;
  private reader: ContactReader;

  constructor(options?: ContactsOptions) {
    this.db = openDatabase(options?.dbPath);
    this.reader = new ContactReader(this.db);
  }

  contacts(options?: ListContactsOptions): Contact[] {
    return this.reader.listContacts(options);
  }

  getContact(contactId: number): ContactDetails {
    const contact = this.reader.getContact(contactId);
    if (!contact) throw new ContactNotFoundError(contactId);
    return contact;
  }

  search(query: string, options?: SearchContactsOptions): ContactSummary[] {
    return this.reader.searchContacts(query, options);
  }

  groups(options?: ListGroupsOptions): Group[] {
    return this.reader.listGroups(options);
  }

  getGroup(groupId: number): Group {
    const group = this.reader.getGroup(groupId);
    if (!group) throw new GroupNotFoundError(groupId);
    return group;
  }

  groupMembers(groupId: number): Contact[] {
    const group = this.reader.getGroup(groupId);
    if (!group) throw new GroupNotFoundError(groupId);
    return this.reader.getGroupMembers(groupId);
  }

  close(): void {
    this.db.close();
  }

  static requestAccess(): void {
    openFullDiskAccessSettings();
  }
}
