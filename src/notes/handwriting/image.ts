import { readFileSync, statSync } from "node:fs";

// Cap on how large a rendered drawing we will base64-encode for inlining. The
// pixels are still available on disk via imagePath above the cap; we just don't
// stuff a multi-megabyte string into a tool response.
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

// Apple's FallbackImages are PNG data even though the file extension is ".jpg"
// (confirmed by the forensic reverse-engineering of the Notes container), so we
// report image/png regardless of extension.
export const DRAWING_IMAGE_MIME_TYPE = "image/png";

export type LoadedImage =
  | { base64: string; mimeType: string; bytes: number }
  | { tooLarge: true; bytes: number };

// Read an on-disk image and return its base64 + mime type, or a tooLarge marker
// (with the byte size) when it exceeds the inline cap. Callers still have the
// path in that case.
export function loadImageBase64(
  path: string,
  maxBytes: number = MAX_INLINE_IMAGE_BYTES,
): LoadedImage {
  const bytes = statSync(path).size;
  if (bytes > maxBytes) return { tooLarge: true, bytes };
  const buf = readFileSync(path);
  return {
    base64: buf.toString("base64"),
    mimeType: DRAWING_IMAGE_MIME_TYPE,
    bytes,
  };
}
