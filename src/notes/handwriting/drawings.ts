import { isDrawingAttachment } from "../attachments/content-types.ts";
import type { DecodedNote } from "../protobuf/decode.ts";

export interface DrawingRun {
  identifier: string;
  typeUti: string;
}

// Collect the handwritten-drawing attachments referenced by a note, in order,
// de-duplicated by identifier. Mirrors how tables are found in
// Notes.resolveTableAttachments: walk the decoded attribute runs and match on
// attachmentInfo rather than scanning the note text for U+FFFC markers.
// Pure and synchronous so it can be unit-tested without a database.
export function collectDrawingRuns(decoded: DecodedNote): DrawingRun[] {
  const runs: DrawingRun[] = [];
  const seen = new Set<string>();
  for (const run of decoded.attributeRuns) {
    const info = run.attachmentInfo;
    if (!info?.attachmentIdentifier || !info.typeUti) continue;
    if (!isDrawingAttachment(info.typeUti)) continue;
    if (seen.has(info.attachmentIdentifier)) continue;
    seen.add(info.attachmentIdentifier);
    runs.push({ identifier: info.attachmentIdentifier, typeUti: info.typeUti });
  }
  return runs;
}
