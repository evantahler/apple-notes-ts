import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  ContactNotFoundError,
  GroupNotFoundError,
} from "../src/contacts/errors.ts";
import { Contacts } from "../src/index.ts";

const FIXTURE_DB = resolve(import.meta.dir, "fixtures/AddressBook-v22.abcddb");

function idOf<T extends { id: number }>(item: T | undefined): number {
  if (!item) throw new Error("Expected item to be defined");
  return item.id;
}

let db: Contacts;

beforeAll(() => {
  db = new Contacts({ dbPath: FIXTURE_DB });
});

afterAll(() => {
  db.close();
});

// ============================================================================
// contacts()
// ============================================================================

describe("contacts", () => {
  test("returns all contacts", () => {
    const contacts = db.contacts();
    expect(contacts).toHaveLength(5);
  });

  test("contacts have displayName computed from name parts", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    expect(john?.displayName).toBe("John Doe");
  });

  test("organization-only contact uses org as displayName", () => {
    const contacts = db.contacts();
    const acme = contacts.find((c) => c.organization === "Acme Corporation");
    expect(acme).toBeDefined();
    expect(acme?.displayName).toBe("Acme Corporation");
    expect(acme?.firstName).toBe("");
    expect(acme?.lastName).toBe("");
  });

  test("defaults to sorting by displayName ascending", () => {
    const contacts = db.contacts();
    const names = contacts.map((c) => c.displayName);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("sorts by modifiedAt descending", () => {
    const contacts = db.contacts({ sortBy: "modifiedAt", order: "desc" });
    const dates = contacts.map((c) => c.modifiedAt.getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1] as number);
    }
  });

  test("limit restricts result count", () => {
    const all = db.contacts();
    const limited = db.contacts({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.length).toBeLessThan(all.length);
  });

  test("search filters by name", () => {
    const contacts = db.contacts({ search: "john" });
    expect(contacts.length).toBeGreaterThan(0);
    expect(
      contacts.every((c) => c.displayName.toLowerCase().includes("john")),
    ).toBe(true);
  });

  test("search filters by organization", () => {
    const contacts = db.contacts({ search: "acme" });
    expect(contacts.length).toBeGreaterThan(0);
  });

  test("filters by groupId", () => {
    const groups = db.groups();
    const workGroup = groups.find((g) => g.name === "Work");
    expect(workGroup).toBeDefined();

    const contacts = db.contacts({ groupId: idOf(workGroup) });
    expect(contacts).toHaveLength(2);
  });

  test("contacts have dates as Date objects", () => {
    const contacts = db.contacts();
    for (const c of contacts) {
      expect(c.createdAt).toBeInstanceOf(Date);
      expect(c.modifiedAt).toBeInstanceOf(Date);
      expect(c.createdAt.getTime()).toBeGreaterThan(0);
    }
  });

  test("contact with image has hasImage=true", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    expect(john?.hasImage).toBe(true);

    const bob = contacts.find((c) => c.firstName === "Bob");
    expect(bob?.hasImage).toBe(false);
  });
});

// ============================================================================
// getContact()
// ============================================================================

describe("getContact", () => {
  test("returns contact with full details", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    expect(john).toBeDefined();

    const details = db.getContact(idOf(john));
    expect(details.firstName).toBe("John");
    expect(details.lastName).toBe("Doe");
    expect(details.organization).toBe("Acme Inc");
    expect(details.jobTitle).toBe("Software Engineer");
    expect(details.department).toBe("Engineering");
  });

  test("includes emails with cleaned labels", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.emails).toHaveLength(2);
    const workEmail = details.emails.find((e) => e.address === "john@acme.com");
    expect(workEmail).toBeDefined();
    expect(workEmail?.label).toBe("Work");
    expect(workEmail?.isPrimary).toBe(true);

    const homeEmail = details.emails.find(
      (e) => e.address === "johndoe@gmail.com",
    );
    expect(homeEmail?.label).toBe("Home");
    expect(homeEmail?.isPrimary).toBe(false);
  });

  test("includes phones with primary first", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.phones).toHaveLength(2);
    expect(details.phones[0]?.isPrimary).toBe(true);
    expect(details.phones[0]?.label).toBe("Mobile");
  });

  test("includes addresses", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.addresses).toHaveLength(1);
    expect(details.addresses[0]?.city).toBe("San Francisco");
    expect(details.addresses[0]?.state).toBe("CA");
    expect(details.addresses[0]?.label).toBe("Home");
  });

  test("includes URLs", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.urls).toHaveLength(1);
    expect(details.urls[0]?.url).toBe("https://johndoe.dev");
    expect(details.urls[0]?.label).toBe("HomePage");
  });

  test("includes social profiles", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.socialProfiles).toHaveLength(1);
    expect(details.socialProfiles[0]?.service).toBe("Twitter");
    expect(details.socialProfiles[0]?.username).toBe("johndoe");
  });

  test("includes related names", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.relatedNames).toHaveLength(1);
    expect(details.relatedNames[0]?.name).toBe("Jane Doe");
    expect(details.relatedNames[0]?.label).toBe("Spouse");
  });

  test("includes contact dates", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.dates).toHaveLength(1);
    expect(details.dates[0]?.label).toBe("Anniversary");
    expect(details.dates[0]?.date).toBeInstanceOf(Date);
  });

  test("includes note text", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.note).toBe("Met at WWDC 2023. Great engineer, loves Rust.");
  });

  test("includes birthday", () => {
    const contacts = db.contacts();
    const john = contacts.find((c) => c.firstName === "John");
    const details = db.getContact(idOf(john));

    expect(details.birthday).toBeInstanceOf(Date);
    expect(details.birthday?.getFullYear()).toBe(1990);
  });

  test("contact without details has empty arrays", () => {
    const contacts = db.contacts();
    const bob = contacts.find((c) => c.firstName === "Bob");
    const details = db.getContact(idOf(bob));

    expect(details.emails).toHaveLength(0);
    expect(details.phones).toHaveLength(0);
    expect(details.addresses).toHaveLength(0);
    expect(details.urls).toHaveLength(0);
    expect(details.socialProfiles).toHaveLength(0);
    expect(details.relatedNames).toHaveLength(0);
    expect(details.dates).toHaveLength(0);
    expect(details.note).toBeNull();
  });

  test("throws ContactNotFoundError for missing contact", () => {
    expect(() => db.getContact(99999)).toThrow(ContactNotFoundError);
  });
});

// ============================================================================
// search()
// ============================================================================

describe("search", () => {
  test("finds contacts by first name", () => {
    const results = db.search("John");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.firstName === "John")).toBe(true);
  });

  test("finds contacts by last name", () => {
    const results = db.search("Doe");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.lastName === "Doe")).toBe(true);
  });

  test("finds contacts by organization", () => {
    const results = db.search("Acme");
    expect(results.length).toBeGreaterThan(0);
  });

  test("finds contacts by phone number", () => {
    const results = db.search("123-4567");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.firstName === "John")).toBe(true);
  });

  test("finds contacts by email address", () => {
    const results = db.search("alice@example");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.firstName === "Alice")).toBe(true);
  });

  test("search is case-insensitive", () => {
    const results = db.search("JOHN");
    expect(results.length).toBeGreaterThan(0);
  });

  test("respects limit", () => {
    const results = db.search("a", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("returns empty for non-matching query", () => {
    const results = db.search("xyznonexistent999");
    expect(results).toHaveLength(0);
  });

  test("filters by groupId", () => {
    const groups = db.groups();
    const workGroup = groups.find((g) => g.name === "Work");
    const results = db.search("Jane", { groupId: idOf(workGroup) });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.firstName === "Jane")).toBe(true);
  });

  test("includes phones and emails inline, primary first", () => {
    const john = db.search("John").find((r) => r.firstName === "John");
    expect(john).toBeDefined();

    expect(john?.phones).toHaveLength(2);
    expect(john?.phones[0]?.isPrimary).toBe(true);
    expect(john?.phones[0]?.number).toBe("+1 (555) 123-4567");

    expect(john?.emails).toHaveLength(2);
    expect(john?.emails[0]?.isPrimary).toBe(true);
    expect(john?.emails[0]?.address).toBe("john@acme.com");
  });

  test("returns empty arrays for a contact with no phones or emails", () => {
    const bob = db.search("Bob").find((r) => r.firstName === "Bob");
    expect(bob).toBeDefined();
    expect(bob?.phones).toEqual([]);
    expect(bob?.emails).toEqual([]);
  });
});

// ============================================================================
// groups()
// ============================================================================

describe("groups", () => {
  test("returns all groups", () => {
    const groups = db.groups();
    expect(groups).toHaveLength(2);
  });

  test("groups have member counts", () => {
    const groups = db.groups();
    const work = groups.find((g) => g.name === "Work");
    expect(work?.memberCount).toBe(2);

    const friends = groups.find((g) => g.name === "Friends");
    expect(friends?.memberCount).toBe(2);
  });

  test("groups are sorted by name", () => {
    const groups = db.groups();
    const names = groups.map((g) => g.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("limit restricts result count", () => {
    const limited = db.groups({ limit: 1 });
    expect(limited).toHaveLength(1);
  });
});

// ============================================================================
// getGroup()
// ============================================================================

describe("getGroup", () => {
  test("returns a single group by ID", () => {
    const groups = db.groups();
    const work = groups.find((g) => g.name === "Work");
    const group = db.getGroup(idOf(work));
    expect(group.name).toBe("Work");
    expect(group.memberCount).toBe(2);
  });

  test("throws GroupNotFoundError for missing group", () => {
    expect(() => db.getGroup(99999)).toThrow(GroupNotFoundError);
  });
});

// ============================================================================
// groupMembers()
// ============================================================================

describe("groupMembers", () => {
  test("returns contacts in a group", () => {
    const groups = db.groups();
    const work = groups.find((g) => g.name === "Work");
    const members = db.groupMembers(idOf(work));
    expect(members).toHaveLength(2);
    const names = members.map((m) => m.firstName);
    expect(names).toContain("John");
    expect(names).toContain("Jane");
  });

  test("contact in multiple groups appears in both", () => {
    const groups = db.groups();
    const work = groups.find((g) => g.name === "Work");
    const friends = groups.find((g) => g.name === "Friends");

    const workMembers = db.groupMembers(idOf(work));
    const friendsMembers = db.groupMembers(idOf(friends));

    expect(workMembers.some((m) => m.firstName === "Jane")).toBe(true);
    expect(friendsMembers.some((m) => m.firstName === "Jane")).toBe(true);
  });

  test("throws GroupNotFoundError for missing group", () => {
    expect(() => db.groupMembers(99999)).toThrow(GroupNotFoundError);
  });
});

// ============================================================================
// close()
// ============================================================================

describe("close", () => {
  test("does not throw", () => {
    const tempDb = new Contacts({ dbPath: FIXTURE_DB });
    expect(() => tempDb.close()).not.toThrow();
  });
});
