// Structure-classifier accuracy harness — ported from evals/structure_accuracy.py.
// Runs classifyStructureFromFen against the canonical labeled FENs and reports accuracy.
import { classifyStructureFromFen } from "../packages/chess-tools/dist/index.js";

const FIXTURES = [
  ["r1bqkb1r/pp3ppp/2n2n2/8/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1", "IQP"],
  ["r1bqkb1r/pp3ppp/2p2n2/3p4/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1", "Carlsbad"],
  ["r1bqkbnr/pp1p1ppp/2n5/8/2P1P3/8/PP3PPP/RNBQKBNR w KQkq - 0 1", "Maroczy"],
  ["r1b1kbnr/pp3ppp/1qn1p3/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R w KQkq - 3 6", "French"],
  ["rnb1k2r/pp2q1pp/2pbpn2/3p1p2/2PP4/1P3NP1/P3PPBP/RNBQ1RK1 w kq - 1 8", "Stonewall"],
  ["rnbq1rk1/1pp2pbp/3p1np1/p2Pp3/2P1P3/2N2N2/PP2BPPP/R1BQK2R w KQ - 0 8", "King's Indian"],
  ["rnbqk2r/pp3pbp/3p1np1/2pP4/4P3/2N2N2/PP3PPP/R1BQKB1R w KQkq - 2 8", "Benoni"],
  ["r1bqk1nr/pp2ppbp/2np2p1/2p5/4PP2/2NP2P1/PPP3BP/R1BQK1NR b KQkq - 0 6", "Closed Sicilian"],
  ["rnbqk2r/p1pp1ppp/1p2pn2/8/2PP4/P1P1P3/5PPP/R1BQKBNR b KQkq - 0 6", "Nimzo-Grünfeld"],
  ["rnbqkb1r/ppp1pp1p/6p1/8/3PP3/2P5/P4PPP/R1BQKBNR b KQkq - 0 6", "Grünfeld Centre"],
  ["rnbqkb1r/5ppp/pp1ppn2/8/2PNP3/2N5/PP2BPPP/R1BQK2R w KQkq - 0 8", "Hedgehog"],
  ["rnbqkb1r/1p3ppp/p2p1n2/4p3/3NP3/2N5/PPP1BPPP/R1BQK2R w KQkq - 0 7", "Najdorf"],
  ["rnbqkb1r/1p3ppp/p2ppn2/8/3NP3/2N5/PPP1BPPP/R1BQK2R w KQkq - 0 7", "Scheveningen"],
  ["rn1qkbnr/pp3ppp/2p1p3/3pPb2/3P4/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 5", "Caro-Kann"],
  ["rn1qkb1r/pp3ppp/2p1pn2/3p1b2/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 6", "Slav"],
  ["r1bq1rk1/2p1bppp/p1np1n2/1p2p3/4P3/1BPP1N2/PP3PPP/RNBQR1K1 b - - 0 9", "Lopez"],
  ["rn1qkb1r/4pppp/b2p1n2/2pP4/8/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 7", "Benko"],
  ["rnb2rk1/p3qpp1/7p/2pp4/8/4PN2/PP2BPPP/R2QK2R w KQ - 0 13", "Hanging pawns"],
  ["rnbqk2r/pp2bppp/3p1n2/2pPp3/2P1P3/2N5/PP3PPP/R1BQKBNR w KQkq - 1 6", "Symmetric Benoni"],
  ["r1bqk2r/pp2bppp/2n5/2pnp3/8/PP1PPN2/5PPP/RNBQKB1R b KQkq - 0 8", "Hedgehog"],
  ["r1bqk2r/ppp1bppp/2n5/3np3/4P3/P2P1N2/1P3PPP/RNBQKB1R b KQkq - 0 7", "Najdorf"],
  ["1rbq1rk1/ppp2pp1/2nb3p/4p3/3P4/2P2NP1/P1Q1PPBP/1RB2RK1 b - - 1 11", "Grünfeld Centre"],
  ["r1bqkb1r/pp1n1ppp/2p1pn2/3p4/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 1 6", "Slav"],
  ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "unknown"],
  ["rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "unknown"],
  ["r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", "unknown"],
  ["r2q1rk1/1p2ppbp/p1np1np1/2p5/2P1P1b1/P1NPB1P1/1P2NPBP/R2Q1RK1 b - - 2 10", "unknown"],
];

let pass = 0;
const mismatches = [];
for (const [fen, expected] of FIXTURES) {
  const got = classifyStructureFromFen(fen).structure_class;
  if (got === expected) pass++;
  else mismatches.push(`expected ${expected}, got ${got}  ::  ${fen}`);
}
console.log(`structure accuracy: ${pass}/${FIXTURES.length}`);
for (const m of mismatches) console.log("  MISMATCH:", m);
process.exit(mismatches.length ? 1 : 0);
