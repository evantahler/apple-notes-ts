import type {
  Contact,
  ContactDetails,
  Contacts,
  Group,
} from "../src/contacts/index.ts";
import {
  type AppState,
  bodyRows,
  contactDetailPanelWidth,
  contactListPanelWidth,
  groupPanelWidth,
  handleScrollKeys,
  highlightLine,
  moveTo,
  scrollIntoView,
  term,
  totalCols,
  truncate,
  visibleLength,
} from "./helpers.ts";

// ── Actions ─────────────────────────────────────────────────────────────────

export function loadContactsForGroup(state: AppState, contactsDb: Contacts) {
  const cs = state.contactsState;
  if (cs.groupIndex === 0) {
    cs.contacts = cs.allContacts;
  } else {
    const group = cs.groups[cs.groupIndex - 1];
    if (group) {
      cs.contacts = contactsDb.groupMembers(group.id);
    }
  }
  cs.contactIndex = 0;
  cs.contactScroll = 0;
  state.statusMessage = "";
  loadSelectedContact(state, contactsDb);
}

export function buildContactDetailLines(
  d: ContactDetails,
  width: number,
): string[] {
  const lines: string[] = [];
  const w = Math.max(20, width - 2);

  // Name header
  lines.push(`${term.bold}${d.displayName}${term.reset}`);
  if (d.organization) {
    lines.push(`${term.fg.gray}${d.organization}${term.reset}`);
  }
  if (d.jobTitle || d.department) {
    const parts = [d.jobTitle, d.department].filter(Boolean).join(", ");
    lines.push(`${term.fg.gray}${parts}${term.reset}`);
  }
  lines.push("");

  // Phones
  if (d.phones.length > 0) {
    lines.push(`${term.bold}Phone${term.reset}`);
    for (const p of d.phones) {
      const label = p.label ? `${term.fg.gray}${p.label}${term.reset} ` : "";
      const primary = p.isPrimary ? ` ${term.fg.cyan}\u2605${term.reset}` : "";
      lines.push(`  ${label}${p.number}${primary}`);
    }
    lines.push("");
  }

  // Emails
  if (d.emails.length > 0) {
    lines.push(`${term.bold}Email${term.reset}`);
    for (const e of d.emails) {
      const label = e.label ? `${term.fg.gray}${e.label}${term.reset} ` : "";
      const primary = e.isPrimary ? ` ${term.fg.cyan}\u2605${term.reset}` : "";
      lines.push(`  ${label}${e.address}${primary}`);
    }
    lines.push("");
  }

  // Addresses
  if (d.addresses.length > 0) {
    lines.push(`${term.bold}Address${term.reset}`);
    for (const a of d.addresses) {
      const label = a.label ? `${term.fg.gray}${a.label}${term.reset}` : "";
      if (label) lines.push(`  ${label}`);
      if (a.street) lines.push(`  ${a.street}`);
      const cityState = [a.city, a.state, a.zipCode].filter(Boolean).join(", ");
      if (cityState) lines.push(`  ${cityState}`);
      if (a.country) lines.push(`  ${a.country}`);
    }
    lines.push("");
  }

  // URLs
  if (d.urls.length > 0) {
    lines.push(`${term.bold}URL${term.reset}`);
    for (const u of d.urls) {
      const label = u.label ? `${term.fg.gray}${u.label}${term.reset} ` : "";
      lines.push(
        `  ${label}${term.fg.cyan}${term.underline}${u.url}${term.reset}`,
      );
    }
    lines.push("");
  }

  // Social profiles
  if (d.socialProfiles.length > 0) {
    lines.push(`${term.bold}Social${term.reset}`);
    for (const sp of d.socialProfiles) {
      const service = sp.service
        ? `${term.fg.gray}${sp.service}${term.reset} `
        : "";
      const handle = sp.username || sp.url || "";
      lines.push(`  ${service}${handle}`);
    }
    lines.push("");
  }

  // Related names
  if (d.relatedNames.length > 0) {
    lines.push(`${term.bold}Related${term.reset}`);
    for (const r of d.relatedNames) {
      const label = r.label ? `${term.fg.gray}${r.label}${term.reset} ` : "";
      lines.push(`  ${label}${r.name}`);
    }
    lines.push("");
  }

  // Dates
  if (d.birthday) {
    lines.push(
      `${term.bold}Birthday${term.reset}  ${d.birthday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    );
  }
  if (d.dates.length > 0) {
    for (const dt of d.dates) {
      const label = dt.label ? `${term.bold}${dt.label}${term.reset}  ` : "";
      lines.push(
        `${label}${dt.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      );
    }
  }
  if (d.birthday || d.dates.length > 0) lines.push("");

  // Note
  if (d.note) {
    lines.push(`${term.bold}Note${term.reset}`);
    const noteLines = d.note.split("\n");
    for (const nl of noteLines) {
      lines.push(`  ${truncate(nl, w)}`);
    }
    lines.push("");
  }

  // Metadata
  lines.push(
    `${term.dim}Created: ${d.createdAt.toLocaleDateString()}  Modified: ${d.modifiedAt.toLocaleDateString()}${term.reset}`,
  );

  return lines;
}

export function loadSelectedContact(state: AppState, contactsDb: Contacts) {
  const cs = state.contactsState;
  const contact = cs.contacts[cs.contactIndex];
  if (!contact) {
    cs.details = null;
    cs.detailLines = [];
    cs.detailScroll = 0;
    return;
  }
  cs.detailScroll = 0;
  try {
    cs.details = contactsDb.getContact(contact.id);
    cs.detailLines = buildContactDetailLines(
      cs.details,
      contactDetailPanelWidth(),
    );
  } catch {
    cs.details = null;
    cs.detailLines = [
      "",
      `  ${term.fg.red}Error loading contact details${term.reset}`,
    ];
  }
}

export function selectGroup(
  state: AppState,
  contactsDb: Contacts,
  index: number,
) {
  const cs = state.contactsState;
  const maxIndex = cs.groups.length; // +1 for "All Contacts" row at index 0
  const result = scrollIntoView(index, cs.groupScroll, maxIndex, bodyRows());
  cs.groupIndex = result.index;
  cs.groupScroll = result.scroll;
  loadContactsForGroup(state, contactsDb);
}

export function selectContact(
  state: AppState,
  contactsDb: Contacts,
  index: number,
) {
  const cs = state.contactsState;
  const result = scrollIntoView(
    index,
    cs.contactScroll,
    cs.contacts.length - 1,
    bodyRows(),
  );
  cs.contactIndex = result.index;
  cs.contactScroll = result.scroll;
  loadSelectedContact(state, contactsDb);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

export function drawContactsTab(state: AppState): string {
  const cs = state.contactsState;
  const tc = totalCols();
  const gw = groupPanelWidth();
  const clw = contactListPanelWidth();
  const dw = contactDetailPanelWidth();
  const br = bodyRows();

  let buf = "";

  // Header
  const groupsLabel =
    cs.focus === "groups"
      ? `${term.underline}Groups${term.reset}${term.inverse}${term.bold}`
      : "Groups";
  const contactsLabel =
    cs.focus === "contacts"
      ? `${term.underline}Contacts${term.reset}${term.inverse}${term.bold}`
      : "Contacts";
  const detailsLabel =
    cs.focus === "details"
      ? `${term.underline}Details${term.reset}${term.inverse}${term.bold}`
      : "Details";
  const headerText = ` ${groupsLabel} → ${contactsLabel} → ${detailsLabel} `;
  const headerVis = visibleLength(headerText);
  buf += `${term.inverse}${term.bold}${headerText}${" ".repeat(Math.max(0, tc - headerVis))}${term.reset}`;

  // Body rows
  for (let row = 0; row < br; row++) {
    buf += moveTo(row + 2, 0);

    // Groups panel
    const groupIdx = row + cs.groupScroll;
    const totalGroupItems = cs.groups.length + 1;
    if (groupIdx < totalGroupItems) {
      const isSelected = groupIdx === cs.groupIndex;
      const isFocused = cs.focus === "groups";

      let line: string;
      if (groupIdx === 0) {
        line = ` \u25C6 All Contacts (${cs.allContacts.length})`;
      } else {
        const group = cs.groups[groupIdx - 1] as Group;
        line = ` \u25B8 ${group.name} (${group.memberCount})`;
      }

      buf += highlightLine(line, gw, isSelected, isFocused);
    } else {
      buf += " ".repeat(gw);
    }

    buf += `${term.dim}\u2502${term.reset}`;

    // Contact list panel
    const contactIdx = row + cs.contactScroll;
    if (contactIdx < cs.contacts.length) {
      const contact = cs.contacts[contactIdx] as Contact;
      const isSelected = contactIdx === cs.contactIndex;
      const isFocused = cs.focus === "contacts";

      const orgSuffix = contact.organization
        ? `${term.dim} \u00B7 ${contact.organization}${term.reset}`
        : "";
      const nameText = truncate(contact.displayName, Math.max(5, clw - 2));
      const line = ` ${nameText}${orgSuffix}`;

      buf += highlightLine(line, clw, isSelected, isFocused);
    } else {
      buf += " ".repeat(clw);
    }

    buf += `${term.dim}\u2502${term.reset}`;

    // Details panel
    const detailIdx = row + cs.detailScroll;
    if (detailIdx >= 0 && detailIdx < cs.detailLines.length) {
      const line = cs.detailLines[detailIdx] as string;
      buf += ` ${truncate(line, dw - 1)}`;
    }
  }

  return buf;
}

// ── Input ───────────────────────────────────────────────────────────────────

export function handleContactsInput(
  state: AppState,
  contactsDb: Contacts,
  s: string,
) {
  const cs = state.contactsState;
  const maxDetailScroll = Math.max(0, cs.detailLines.length - bodyRows());

  // j/k scroll keys (always scroll details)
  const scrollResult = handleScrollKeys(s, cs.detailScroll, maxDetailScroll);
  if (scrollResult !== null) {
    cs.detailScroll = scrollResult;
    return;
  }

  switch (s) {
    case "\x1b[D": // Left arrow
      if (cs.focus === "details") cs.focus = "contacts";
      else if (cs.focus === "contacts") cs.focus = "groups";
      break;
    case "\x1b[C": // Right arrow
      if (cs.focus === "groups") cs.focus = "contacts";
      else if (cs.focus === "contacts") cs.focus = "details";
      break;
    case "\x1b[A": // Up
      if (cs.focus === "groups")
        selectGroup(state, contactsDb, cs.groupIndex - 1);
      else if (cs.focus === "contacts")
        selectContact(state, contactsDb, cs.contactIndex - 1);
      else cs.detailScroll = Math.max(0, cs.detailScroll - 1);
      break;
    case "\x1b[B": // Down
      if (cs.focus === "groups")
        selectGroup(state, contactsDb, cs.groupIndex + 1);
      else if (cs.focus === "contacts")
        selectContact(state, contactsDb, cs.contactIndex + 1);
      else cs.detailScroll = Math.min(maxDetailScroll, cs.detailScroll + 1);
      break;
    case "\x1b[5~": // Page Up
      if (cs.focus === "groups")
        selectGroup(state, contactsDb, cs.groupIndex - bodyRows());
      else if (cs.focus === "contacts")
        selectContact(state, contactsDb, cs.contactIndex - bodyRows());
      else cs.detailScroll = Math.max(0, cs.detailScroll - bodyRows());
      break;
    case "\x1b[6~": // Page Down
      if (cs.focus === "groups")
        selectGroup(state, contactsDb, cs.groupIndex + bodyRows());
      else if (cs.focus === "contacts")
        selectContact(state, contactsDb, cs.contactIndex + bodyRows());
      else
        cs.detailScroll = Math.min(
          maxDetailScroll,
          cs.detailScroll + bodyRows(),
        );
      break;
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

export function doContactsSearch(state: AppState, contactsDb: Contacts) {
  const query = state.searchQuery.trim();
  state.searchMode = false;
  if (!query) {
    loadContactsForGroup(state, contactsDb);
    state.statusMessage = "";
    return;
  }
  state.contactsState.contacts = contactsDb.search(query);
  state.statusMessage = `${state.contactsState.contacts.length} contact${state.contactsState.contacts.length === 1 ? "" : "s"} matching "${query}"`;
  state.contactsState.contactIndex = 0;
  state.contactsState.contactScroll = 0;
  loadSelectedContact(state, contactsDb);
}
