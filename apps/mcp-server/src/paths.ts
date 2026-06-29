/**
 * Filesystem-access boundary for the file-path tools (load_repertoire_from_file /
 * export_repertoire_to_file). Untrusted caller paths and file sizes are the threat here: this
 * module is the single place that resolves a caller path into BASE and caps the bytes read. Kept
 * pure + import-safe (no server side effects) so it is unit-tested directly by test/confine.mjs.
 */
import { resolve as pathResolve, dirname, join, basename, sep } from "node:path";
import { realpathSync } from "node:fs";
import { open } from "node:fs/promises";

// File-path tools are confined to REPERTOIRE_DIR. Resolve the base's REAL path up front so the
// containment check compares symlink-resolved paths on both sides; if the dir doesn't exist yet
// (fresh checkout) fall back to the lexical path — all file ops then fail closed anyway.
const rawBase = pathResolve(process.env.REPERTOIRE_DIR ?? pathResolve(process.cwd(), "repertoires"));
export const BASE = (() => {
  try {
    return realpathSync(rawBase);
  } catch {
    return rawBase;
  }
})();

/** Hard cap on a single PGN's bytes (string input or file read). Bounds parse/memory DoS. */
export const MAX_PGN_BYTES = Number(process.env.MAX_PGN_BYTES ?? 8 * 1024 * 1024);

const inside = (real: string): boolean => real === BASE || real.startsWith(BASE + sep);

/**
 * Resolve a caller path under BASE, or null if it escapes. Defends path traversal (`../`),
 * absolute paths, AND symlink escape: symlinks are resolved BEFORE the containment check, so
 * neither a symlinked target file (read) nor a symlinked parent (export to a new file) can point
 * outside BASE. The deepest existing ancestor is realpath-resolved and the not-yet-existing tail
 * (an export's new filename) re-appended, then containment is re-verified on the real path.
 */
export function confine(p: string): string | null {
  const target = pathResolve(BASE, p);
  if (!inside(target)) return null; // lexical reject: `../` escapes and absolute paths
  const tail: string[] = [];
  let probe = target;
  for (;;) {
    try {
      probe = realpathSync(probe);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return null; // reached the root without finding an existing ancestor
      tail.unshift(basename(probe));
      probe = parent;
    }
  }
  const real = tail.length ? join(probe, ...tail) : probe;
  return inside(real) ? real : null;
}

/**
 * Read a PGN file (already resolved by `confine`), capped at MAX_PGN_BYTES on the bytes ACTUALLY
 * read — not a pre-read stat (TOCTOU-safe). Reads up to cap+1 bytes; > cap ⇒ { tooLarge }, so a
 * huge file never lands fully in memory. ENOENT / unreadable ⇒ { notFound } (no raw fs error,
 * no host path, surfaces upstream).
 */
export async function readCappedPgn(
  real: string,
): Promise<{ text: string } | { tooLarge: true } | { notFound: true }> {
  let fh;
  try {
    fh = await open(real, "r");
  } catch {
    return { notFound: true };
  }
  try {
    const buf = Buffer.alloc(MAX_PGN_BYTES + 1);
    let total = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, total, buf.length - total, total);
      if (bytesRead === 0) break; // EOF
      total += bytesRead;
      if (total > MAX_PGN_BYTES) return { tooLarge: true };
    }
    return { text: buf.subarray(0, total).toString("utf8") };
  } finally {
    await fh.close();
  }
}
