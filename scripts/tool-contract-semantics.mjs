import assert from "node:assert/strict";
import {
  GameTree, TOOL_CONTRACTS, annotatedGameResult, gameAnalysisResult, gameSummaryResult, groundPosition, illustrativeLinesResult,
  gapScanOperation, jsonSchemaForTool, repertoireCoverageResult, shapeEvaluation, structuralProfileResult,
  toolDefault, transpositionResult, validateToolArguments,
} from "../packages/chess-tools/dist/index.js";

const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const grounded = groundPosition(start);
assert.equal("error" in grounded, false);
assert.equal(grounded.turn, "white");
assert.equal(grounded.legal_moves.length, 20);
assert.equal(groundPosition("garbage").error, "invalid_fen");
assert.deepEqual(
  shapeEvaluation(start, [{ uci: "e2e4", cp: 31, mate: null, depth: 16, pv: ["e2e4"] }], () => "e4"),
  { fen: start, eval_pov: "white", eval_sign: "positive favors White; negative favors Black", lines: [{ uci: "e2e4", san: "e4", cp: 31, mate: null, depth: 16 }] },
);
assert.equal(toolDefault("evaluate_position", "depth", 0), 16);
assert.deepEqual(jsonSchemaForTool("compare_moves", "browser").required, ["moves"]);
assert.equal("repertoire_id" in jsonSchemaForTool("find_repertoire_gaps", "browser").properties, false);
assert.equal("repertoire_id" in jsonSchemaForTool("find_repertoire_gaps", "mcp").properties, true);
assert.equal(validateToolArguments("evaluate_position", { depth: 31 }, "browser").error, "invalid_arguments");
assert.equal(validateToolArguments("compare_moves", { moves: ["e4", 2] }, "browser").error, "invalid_arguments");
assert.equal(validateToolArguments("compare_moves", { moves: ["e4"], surprise: true }, "browser").error, "invalid_arguments");
assert.equal(validateToolArguments("compare_moves", { moves: ["e4"], depth: 12 }, "browser").ok, true);
assert.equal(validateToolArguments("analyze_repertoire_congruence", { acknowledged_weaknesses: [["e4", 2]] }, "browser").error, "invalid_arguments");

const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 (2. Nc3 Nf6) Nc6 *");
assert.equal(transpositionResult(tree, 20).total, tree.transpositions().length);
assert.equal(repertoireCoverageResult(tree, "white", 20).leaves, tree.coverage("white").leaves);
assert.equal(illustrativeLinesResult(tree, "white", 20).leaves_total, tree.stats().leaves);
assert.equal(structuralProfileResult(tree, "white").color, "white");
assert.equal(structuralProfileResult(tree, "white", ["d4"]).error, "variation_not_found");

const records = [
  { ply: 1, color: "white", san: "e4", cp_loss: 0, classification: "good" },
  { ply: 2, color: "black", san: "e5", cp_loss: 120, classification: "mistake" },
];
assert.deepEqual(gameAnalysisResult(records), { total_moves: 2, moves: records });
const summary = gameSummaryResult(records);
assert.equal(summary.black.mistakes, 1);
assert.equal(summary.worst_moves[0].san, "e5");
const annotated = annotatedGameResult("1. e4 e5 *", [
  { ...records[0], best_move: "e4", best_eval: 20 },
  { ...records[1], best_move: "Nf6", best_eval: 10 },
]);
assert.match(annotated.annotated_pgn, /best: Nf6/);
const gapResult = await gapScanOperation(
  GameTree.fromPgn("1. e4 e5 2. Nf3 *"),
  "white",
  { depth: 1, min_severity: "low", max_positions: 1, limit: 5 },
  async () => [
    { uci: "e7e5", cp: 0, mate: null, depth: 1, pv: ["e7e5"] },
    { uci: "c7c5", cp: 10, mate: null, depth: 1, pv: ["c7c5"] },
  ],
);
assert.equal(gapResult.positions_scanned, 1);
assert.equal(TOOL_CONTRACTS.every((tool) => tool.input && tool.result), true);
assert.equal(TOOL_CONTRACTS.find((tool) => tool.name === "export_annotated_pgn").result.kind, "artifact");
assert.equal(TOOL_CONTRACTS.find((tool) => tool.name === "propose_line").result.kind, "action");
console.log("tool contract semantics: ok");
