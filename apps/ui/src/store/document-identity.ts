/** Stable identity for one browser working document. Kept independent from PGN contents/revisions. */
export type BrowserDocumentId = string;

type SecureUuidSource = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
};

// RFC UUID text with a standardized version nibble and the RFC variant. UUIDs are canonicalized
// to lowercase at the persistence boundary so equivalent text cannot produce distinct keys.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeBrowserDocumentId(value: unknown): BrowserDocumentId | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function bytesToUuid(bytes: Uint8Array): BrowserDocumentId {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Generate a secure RFC 4122 version-4 ID, preferring the browser's native implementation. */
export function createBrowserDocumentId(source: SecureUuidSource = globalThis.crypto): BrowserDocumentId {
  const native = source?.randomUUID?.();
  const normalized = normalizeBrowserDocumentId(native);
  if (normalized) return normalized;

  if (!source?.getRandomValues) {
    throw new Error("Secure browser UUID generation is unavailable");
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}
