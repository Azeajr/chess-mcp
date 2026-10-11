import { CREDENTIAL_REMOVED } from "../content/chat";

// A credential typed into chat would reach the model provider and the stored conversation, while
// the app only ever reads one from Settings. Known token shapes are removed before either sees the
// message; the caller opens Settings at the field so the user can enter it there.
const CREDENTIALS = [
  { field: "lichess-token", pattern: /\blip_[A-Za-z0-9]{12,}\b/g },
  { field: "api-key", pattern: /\bsk-or-(?:v1-)?[A-Za-z0-9]{16,}\b/g },
] as const;

export type CredentialField = (typeof CREDENTIALS)[number]["field"];

export function withoutCredentials(text: string): { text: string; fields: CredentialField[] } {
  const fields: CredentialField[] = [];
  let cleaned = text;
  for (const { field, pattern } of CREDENTIALS) {
    const next = cleaned.replace(pattern, CREDENTIAL_REMOVED[field]);
    if (next !== cleaned) fields.push(field);
    cleaned = next;
  }
  return { text: cleaned, fields };
}
