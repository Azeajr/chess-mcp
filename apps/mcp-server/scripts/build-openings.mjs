/**
 * Generate data/openings.tsv (the ECO lookup table) from lichess-org/chess-openings (CC0).
 * Each source row is eco<TAB>name<TAB>pgn; we replay the PGN with chessops and key the opening
 * by positionKey (placement+turn+castling+ep) — the SAME key the lookup uses, so the table is
 * self-consistent and free of the python-chess-vs-chessops EPD parity risk. Re-run to refresh:
 *   node apps/mcp-server/scripts/build-openings.mjs
 */
import { Chess } from "chessops/chess";
import { parseSan } from "chessops/san";
import { makeFen } from "chessops/fen";
import { parsePgn } from "chessops/pgn";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master";
const FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];
const positionKey = (fen) => fen.split(" ").slice(0, 4).join(" ");

const out = [];
let skipped = 0;
for (const f of FILES) {
  const text = await (await fetch(`${BASE}/${f}`)).text();
  for (const line of text.split("\n").slice(1)) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split("\t");
    if (!pgn) continue;
    const game = parsePgn(pgn)[0];
    if (!game) {
      skipped++;
      continue;
    }
    const pos = Chess.default();
    let node = game.moves;
    let okLine = true;
    while (node.children.length) {
      const child = node.children[0];
      const move = parseSan(pos, child.data.san);
      if (!move) {
        okLine = false;
        break;
      }
      pos.play(move);
      node = child;
    }
    if (!okLine) {
      skipped++;
      continue;
    }
    out.push(`${positionKey(makeFen(pos.toSetup()))}\t${eco}\t${name}`);
  }
}

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "openings.tsv"), out.join("\n") + "\n");
console.error(`wrote ${out.length} openings (${skipped} skipped) → data/openings.tsv`);
