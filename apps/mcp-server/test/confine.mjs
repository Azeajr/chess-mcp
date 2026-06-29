// Engine-free unit test for the filesystem-access guard (src/paths.ts: confine + readCappedPgn).
// REPERTOIRE_DIR / MAX_PGN_BYTES are read once at module load, so set them BEFORE importing.
// Run: node --import tsx apps/mcp-server/test/confine.mjs
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = realpathSync(mkdtempSync(join(tmpdir(), "confine-")));
const base = join(root, "repertoires"); // the confined dir
const outside = join(root, "outside"); // a sibling the caller must never reach
mkdirSync(base);
mkdirSync(outside);
mkdirSync(join(base, "sub")); // a real subdir (a new file here is allowed)
writeFileSync(join(outside, "secret.txt"), "SECRET\n");
symlinkSync(join(outside, "secret.txt"), join(base, "escape.pgn")); // leaf symlink → outside (read escape)
symlinkSync(outside, join(base, "evildir")); // dir symlink → outside (write-via-parent escape)
writeFileSync(join(base, "ok.pgn"), "1. e4 *\n");
writeFileSync(join(base, "big.pgn"), "x".repeat(64)); // > MAX_PGN_BYTES (set to 16 below)

process.env.REPERTOIRE_DIR = base;
process.env.MAX_PGN_BYTES = "16";
const { confine, readCappedPgn, BASE } = await import("../src/paths.ts");

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

ok(BASE === base, "BASE resolves to REPERTOIRE_DIR");

// confine — containment
ok(confine("ok.pgn") === join(base, "ok.pgn"), "a normal in-base path is allowed");
ok(confine("sub/new.pgn") === join(base, "sub", "new.pgn"), "a new file in a real subdir is allowed");
ok(confine("../outside/secret.txt") === null, "traversal (../) escape is blocked");
ok(confine("/etc/passwd") === null, "absolute-path escape is blocked");
ok(confine("escape.pgn") === null, "leaf-symlink escape (read) is blocked — realpath resolved first");
ok(confine("evildir/new.pgn") === null, "parent-symlink escape (write to a new file) is blocked");

// readCappedPgn — byte cap on bytes actually read + missing file
const small = await readCappedPgn(confine("ok.pgn"));
ok("text" in small && small.text.includes("1. e4"), "readCappedPgn returns the file text under the cap");
const big = await readCappedPgn(confine("big.pgn"));
ok("tooLarge" in big, "readCappedPgn rejects a file over MAX_PGN_BYTES (no full read into memory)");
const missing = await readCappedPgn(join(base, "nope.pgn"));
ok("notFound" in missing, "readCappedPgn reports a missing file as notFound (no raw fs error)");

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
