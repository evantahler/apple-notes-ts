/**
 * Example: List Apple Notes on this machine and display one at random as markdown.
 *
 * Requires Full Disk Access for the terminal running this script.
 * Run with: bun example
 */

import { AppleNotes } from "./src/index.ts";

const db = new AppleNotes();

// List all accounts and folders
const accounts = db.accounts();
console.log("Accounts:");
for (const a of accounts) {
  console.log(`  - ${a.name} (id: ${a.id})`);
}
console.log();

const folders = db.folders();
console.log("Folders:");
for (const f of folders) {
  console.log(`  - ${f.name} (${f.accountName})`);
}
console.log();

// List all notes
const allNotes = db.notes();
console.log(`Total notes: ${allNotes.length}`);
console.log();

// Show a few note titles
console.log("Recent notes:");
for (const n of allNotes.slice(0, 10)) {
  const date = n.modifiedAt.toLocaleDateString();
  console.log(`  [${n.id}] ${n.title} — ${n.folderName} (${date})`);
}
console.log();

// Pick a random non-protected note and display its markdown
const readable = allNotes.filter((n) => !n.isPasswordProtected);
if (readable.length === 0) {
  console.log("No readable notes found.");
} else {
  const pick = readable[Math.floor(Math.random() * readable.length)];
  if (!pick) throw new Error("unreachable");
  console.log(`--- Random note: "${pick.title}" ---`);
  console.log();

  const content = db.read(pick.id);
  console.log(content.markdown);

  // Show attachment info if any
  const attachments = db.getAttachments(pick.id);
  if (attachments.length > 0) {
    console.log();
    console.log(`Attachments (${attachments.length}):`);
    for (const a of attachments) {
      console.log(
        `  - ${a.name} (${a.contentType}) → ${a.url ?? "unresolved"}`,
      );
    }
  }
}

db.close();
