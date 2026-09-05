import { resolve as pathResolve, dirname, join, basename, sep } from "node:path";
import { realpathSync } from "node:fs";
import { open } from "node:fs/promises";

const rawBase = pathResolve(
  process.env.REPERTOIRE_DIR ?? pathResolve(process.cwd(), "repertoires"),
);
export const BASE = (() => {
  try {
    return realpathSync(rawBase);
  } catch {
    return rawBase;
  }
})();

export const MAX_PGN_BYTES = Number(process.env.MAX_PGN_BYTES ?? 8 * 1024 * 1024);

const inside = (real: string): boolean => real === BASE || real.startsWith(BASE + sep);

export function confine(p: string): string | null {
  const target = pathResolve(BASE, p);
  if (!inside(target)) return null;
  const tail: string[] = [];
  let probe = target;
  for (;;) {
    try {
      probe = realpathSync(probe);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return null;
      tail.unshift(basename(probe));
      probe = parent;
    }
  }
  const real = tail.length ? join(probe, ...tail) : probe;
  return inside(real) ? real : null;
}

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
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_PGN_BYTES) return { tooLarge: true };
    }
    return { text: buf.subarray(0, total).toString("utf8") };
  } finally {
    await fh.close();
  }
}
