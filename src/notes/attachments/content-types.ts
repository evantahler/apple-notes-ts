// Apple Notes ZTYPEUTI values that live in the protobuf body or
// ZMERGEABLEDATA1 — they have no on-disk file, so resolveAttachment(...) and
// getAttachmentUrl(...) will always return not-found / null for them.
export const INLINE_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  "com.apple.notes.table",
  "com.apple.notes.gallery",
  "public.url",
]);

const INLINE_ATTACHMENT_PREFIX = "com.apple.notes.inlinetextattachment.";

export function isFileBackedAttachment(contentType: string): boolean {
  if (!contentType) return false;
  if (INLINE_ATTACHMENT_TYPES.has(contentType)) return false;
  if (contentType.startsWith(INLINE_ATTACHMENT_PREFIX)) return false;
  return true;
}

// Apple Pencil / PencilKit handwriting is stored as a drawing attachment. The
// ink strokes live in ZMERGEABLEDATA (an undocumented, versioned CRDT of
// splines with no recognized text), but Apple also renders the drawing to an
// image under Accounts/<acct>/FallbackImages/ once the note is viewed. We use
// that rendered image — never the strokes. The UTI has varied across macOS
// versions: older releases use "com.apple.drawing[.2]"; macOS 26 stores Pencil
// handwriting under the newer "Paper" backing as "com.apple.paper". We match
// "com.apple.paper" exactly (NOT the "com.apple.paper.doc.*" scan/PDF subtypes,
// which are file-backed documents, not ink).
export const DRAWING_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  "com.apple.drawing.2",
  "com.apple.drawing2",
  "com.apple.drawing",
  "com.apple.paper",
]);

export function isDrawingAttachment(contentType: string): boolean {
  if (!contentType) return false;
  return DRAWING_ATTACHMENT_TYPES.has(contentType);
}
