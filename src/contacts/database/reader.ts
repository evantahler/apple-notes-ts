import type { Database } from "bun:sqlite";
import type {
  Contact,
  ContactAddress,
  ContactDate,
  ContactDetails,
  ContactEmail,
  ContactPhone,
  ContactRelatedName,
  ContactSocialProfile,
  ContactSummary,
  ContactURL,
  Group,
  ListContactsOptions,
  ListGroupsOptions,
  SearchContactsOptions,
} from "../types.ts";
import * as Q from "./queries.ts";

interface ContactRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle: string | null;
  department: string | null;
  birthday: number | null;
  createdAt: number | null;
  modifiedAt: number | null;
  hasImage: number;
}

interface GroupRow {
  id: number;
  name: string | null;
}

interface BundleRow {
  kind:
    | "contact"
    | "note"
    | "email"
    | "phone"
    | "address"
    | "url"
    | "social"
    | "related"
    | "date";
  payload: string;
}

export class ContactReader {
  private db: Database;
  private groupMemberCounts: Map<number, number> = new Map();

  constructor(db: Database) {
    this.db = db;
    this.buildCaches();
  }

  private buildCaches(): void {
    const rows = this.db.query(Q.COUNT_GROUP_MEMBERS).all() as {
      groupId: number;
      count: number;
    }[];
    for (const r of rows) {
      this.groupMemberCounts.set(r.groupId, r.count);
    }
  }

  private cleanLabel(label: string | null): string | null {
    if (!label) return null;
    const match = label.match(/^_\$!<(.+)>!\$_$/);
    return match ? (match[1] as string) : label;
  }

  private rowToContact(row: ContactRow): Contact {
    const firstName = row.firstName ?? "";
    const lastName = row.lastName ?? "";
    const displayName =
      `${firstName} ${lastName}`.trim() || row.organization || "No Name";
    return {
      id: row.id,
      firstName,
      lastName,
      displayName,
      organization: row.organization,
      jobTitle: row.jobTitle,
      department: row.department,
      birthday: row.birthday != null ? Q.macTimeToDate(row.birthday) : null,
      note: null,
      hasImage: row.hasImage === 1,
      createdAt: Q.macTimeToDate(row.createdAt),
      modifiedAt: Q.macTimeToDate(row.modifiedAt),
    };
  }

  listContacts(options?: ListContactsOptions): Contact[] {
    let results: Contact[];

    if (options?.groupId != null) {
      const rows = this.db
        .query(Q.LIST_CONTACTS_IN_GROUP)
        .all(options.groupId) as ContactRow[];
      results = rows.map((r) => this.rowToContact(r));
    } else {
      const rows = this.db.query(Q.LIST_CONTACTS).all() as ContactRow[];
      results = rows.map((r) => this.rowToContact(r));
    }

    if (options?.search) {
      const q = options.search.toLowerCase();
      results = results.filter(
        (c) =>
          c.displayName.toLowerCase().includes(q) ||
          (c.organization?.toLowerCase().includes(q) ?? false),
      );
    }

    const sortBy = options?.sortBy ?? "displayName";
    const order = options?.order ?? "asc";
    const mul = order === "asc" ? 1 : -1;

    results.sort((a, b) => {
      switch (sortBy) {
        case "createdAt":
          return mul * (a.createdAt.getTime() - b.createdAt.getTime());
        case "modifiedAt":
          return mul * (a.modifiedAt.getTime() - b.modifiedAt.getTime());
        default:
          return mul * a.displayName.localeCompare(b.displayName);
      }
    });

    if (options?.limit != null && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getContact(contactId: number): ContactDetails | null {
    // contactId binds 9 times — one per UNION ALL branch (contact + 8 detail tables).
    const ids = Array(9).fill(contactId);
    const rows = this.db.query(Q.GET_CONTACT_BUNDLE).all(...ids) as BundleRow[];

    interface Ordered<T> {
      item: T;
      order: number;
    }
    let contact: Contact | null = null;
    let note: string | null = null;
    const orderedEmails: {
      e: ContactEmail;
      isPrimary: boolean;
      idx: number;
    }[] = [];
    const orderedPhones: {
      p: ContactPhone;
      isPrimary: boolean;
      idx: number;
    }[] = [];
    const orderedAddresses: Ordered<ContactAddress>[] = [];
    const orderedUrls: Ordered<ContactURL>[] = [];
    const orderedSocial: Ordered<ContactSocialProfile>[] = [];
    const orderedRelated: Ordered<ContactRelatedName>[] = [];
    const orderedDates: Ordered<ContactDate>[] = [];

    for (const row of rows) {
      const p = JSON.parse(row.payload) as Record<string, unknown>;
      switch (row.kind) {
        case "contact":
          contact = this.rowToContact(p as unknown as ContactRow);
          break;
        case "note":
          note = (p.text as string | null) ?? null;
          break;
        case "email":
          orderedEmails.push({
            e: {
              address: p.address as string,
              label: this.cleanLabel(p.label as string | null),
              isPrimary: p.isPrimary === 1,
            },
            isPrimary: p.isPrimary === 1,
            idx: (p.orderingIndex as number) ?? 0,
          });
          break;
        case "phone":
          orderedPhones.push({
            p: {
              number: p.number as string,
              label: this.cleanLabel(p.label as string | null),
              isPrimary: p.isPrimary === 1,
            },
            isPrimary: p.isPrimary === 1,
            idx: (p.orderingIndex as number) ?? 0,
          });
          break;
        case "address":
          orderedAddresses.push({
            item: {
              street: (p.street as string | null) ?? null,
              city: (p.city as string | null) ?? null,
              state: (p.state as string | null) ?? null,
              zipCode: (p.zipCode as string | null) ?? null,
              country: (p.country as string | null) ?? null,
              label: this.cleanLabel(p.label as string | null),
            },
            order: (p.orderingIndex as number) ?? 0,
          });
          break;
        case "url":
          orderedUrls.push({
            item: {
              url: p.url as string,
              label: this.cleanLabel(p.label as string | null),
            },
            order: (p.orderingIndex as number) ?? 0,
          });
          break;
        case "social":
          orderedSocial.push({
            item: {
              url: (p.url as string | null) ?? null,
              username: (p.username as string | null) ?? null,
              service: (p.service as string | null) ?? null,
              label: this.cleanLabel(p.label as string | null),
            },
            order: (p.orderingIndex as number) ?? 0,
          });
          break;
        case "related":
          orderedRelated.push({
            item: {
              name: p.name as string,
              label: this.cleanLabel(p.label as string | null),
            },
            order: (p.orderingIndex as number) ?? 0,
          });
          break;
        case "date":
          orderedDates.push({
            item: {
              date: Q.macTimeToDate(p.date as number),
              label: this.cleanLabel(p.label as string | null),
            },
            order: (p.orderingIndex as number) ?? 0,
          });
          break;
      }
    }

    if (!contact) return null;

    // emails/phones: primary first, then by orderingIndex
    orderedEmails.sort((a, b) =>
      a.isPrimary !== b.isPrimary ? (a.isPrimary ? -1 : 1) : a.idx - b.idx,
    );
    orderedPhones.sort((a, b) =>
      a.isPrimary !== b.isPrimary ? (a.isPrimary ? -1 : 1) : a.idx - b.idx,
    );

    const byOrder = <T>(a: Ordered<T>, b: Ordered<T>) => a.order - b.order;

    return {
      ...contact,
      note,
      emails: orderedEmails.map((x) => x.e),
      phones: orderedPhones.map((x) => x.p),
      addresses: orderedAddresses.sort(byOrder).map((x) => x.item),
      urls: orderedUrls.sort(byOrder).map((x) => x.item),
      socialProfiles: orderedSocial.sort(byOrder).map((x) => x.item),
      relatedNames: orderedRelated.sort(byOrder).map((x) => x.item),
      dates: orderedDates.sort(byOrder).map((x) => x.item),
    };
  }

  // Enrich summary contacts with their phones and emails via two batched
  // queries (not one-per-contact). Used by searchContacts so a lookup surfaces
  // the contact methods people actually search for without a second round-trip.
  private enrichWithContactMethods(contacts: Contact[]): ContactSummary[] {
    if (contacts.length === 0) return [];

    const ids = contacts.map((c) => c.id);

    const phonesByOwner = new Map<number, ContactPhone[]>();
    for (const r of this.db
      .query(Q.PHONES_FOR_OWNERS(ids.length))
      .all(...ids) as {
      owner: number;
      number: string;
      label: string | null;
      isPrimary: number;
    }[]) {
      const list = phonesByOwner.get(r.owner) ?? [];
      list.push({
        number: r.number,
        label: this.cleanLabel(r.label),
        isPrimary: r.isPrimary === 1,
      });
      phonesByOwner.set(r.owner, list);
    }

    const emailsByOwner = new Map<number, ContactEmail[]>();
    for (const r of this.db
      .query(Q.EMAILS_FOR_OWNERS(ids.length))
      .all(...ids) as {
      owner: number;
      address: string;
      label: string | null;
      isPrimary: number;
    }[]) {
      const list = emailsByOwner.get(r.owner) ?? [];
      list.push({
        address: r.address,
        label: this.cleanLabel(r.label),
        isPrimary: r.isPrimary === 1,
      });
      emailsByOwner.set(r.owner, list);
    }

    return contacts.map((c) => ({
      ...c,
      phones: phonesByOwner.get(c.id) ?? [],
      emails: emailsByOwner.get(c.id) ?? [],
    }));
  }

  searchContacts(
    query: string,
    options?: SearchContactsOptions,
  ): ContactSummary[] {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    // Empty/whitespace query → preserve "match all" behavior with one empty token.
    const effectiveTokens = tokens.length > 0 ? tokens : [""];
    const params = effectiveTokens.flatMap((t) => {
      const p = `%${t}%`;
      return [p, p, p, p, p];
    });
    const rows = this.db
      .query(Q.SEARCH_CONTACTS(effectiveTokens.length))
      .all(...params) as ContactRow[];

    let results = rows.map((r) => this.rowToContact(r));

    if (options?.groupId != null) {
      const memberIds = new Set(
        (
          this.db
            .query(Q.LIST_CONTACTS_IN_GROUP)
            .all(options.groupId) as ContactRow[]
        ).map((r) => r.id),
      );
      results = results.filter((c) => memberIds.has(c.id));
    }

    const limit = options?.limit ?? 50;
    // Slice before enriching so we only fetch contact methods for returned rows.
    return this.enrichWithContactMethods(results.slice(0, limit));
  }

  listGroups(options?: ListGroupsOptions): Group[] {
    const rows = this.db.query(Q.LIST_GROUPS).all() as GroupRow[];
    let results = rows.map(
      (r): Group => ({
        id: r.id,
        name: r.name ?? "Untitled Group",
        memberCount: this.groupMemberCounts.get(r.id) ?? 0,
      }),
    );

    if (options?.limit != null && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getGroup(groupId: number): Group | null {
    const row = this.db.query(Q.GET_GROUP).get(groupId) as GroupRow | null;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name ?? "Untitled Group",
      memberCount: this.groupMemberCounts.get(row.id) ?? 0,
    };
  }

  getGroupMembers(groupId: number): Contact[] {
    const rows = this.db
      .query(Q.LIST_CONTACTS_IN_GROUP)
      .all(groupId) as ContactRow[];
    return rows.map((r) => this.rowToContact(r));
  }
}
