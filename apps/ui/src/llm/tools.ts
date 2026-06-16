/**
 * Chess tools exposed to the chat model (OpenAI function-calling schema) + a local executor.
 * Every tool runs in the browser against chess-tools / the local engine / Lichess — the model
 * never guesses a FEN or eval, it calls these. propose_line stages a suggestion for the user to
 * accept; it does not mutate the repertoire.
 */
import type { ToolSchema } from "./openrouter";
import { fen, color, actions } from "../store/game";
import { analyseMulti } from "../engine/stockfish";
import { cloudEval, legalMoves, moveSan } from "@chess-mcp/chess-tools";
import { addSuggestion } from "../store/suggestions";

export const toolSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_position",
      description:
        "Current board state: FEN, the repertoire color the user plays, and the full working PGN (with variations). Call this to ground yourself before analysing.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_legal_moves",
      description: "Legal moves (SAN) at a position.",
      parameters: {
        type: "object",
        properties: { fen: { type: "string", description: "FEN; defaults to the current position" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_position",
      description:
        "Local Stockfish multi-line analysis. Returns top moves with white-POV evaluation (cp, or mate). Use this for any 'what's best / how good is' question.",
      parameters: {
        type: "object",
        properties: {
          fen: { type: "string", description: "FEN; defaults to the current position" },
          lines: { type: "integer", description: "number of top lines (default 3)" },
        },
      },
    },
  },
  // DISABLED (retro #3): cloud_eval doubled tool calls — the model called it before
  // evaluate_position on every position, and Lichess's cloud DB 404s on obscure repertoire
  // branches (surfaced as { available: false }). evaluate_position (local Stockfish) is
  // authoritative and covers everything. The runTool case + cloudEval import are kept so we can
  // re-enable it (e.g. as a fast mainline cache) once the doubling/404 noise is solved.
  // {
  //   type: "function",
  //   function: {
  //     name: "cloud_eval",
  //     description: "Lichess community cloud evaluation for a position (white-POV), if available.",
  //     parameters: {
  //       type: "object",
  //       properties: { fen: { type: "string", description: "FEN; defaults to the current position" } },
  //     },
  //   },
  // },
  {
    type: "function",
    function: {
      name: "propose_line",
      description:
        "Propose a line for the CURRENT position as SAN moves. It is validated and shown to the user as a blue arrow + an accept/reject entry — it is NOT added to the repertoire until the user accepts. Use this to suggest a concrete continuation.",
      parameters: {
        type: "object",
        properties: {
          moves: { type: "array", items: { type: "string" }, description: "SAN moves from the current position" },
          comment: { type: "string", description: "one-line rationale" },
        },
        required: ["moves"],
      },
    },
  },
];

type Args = Record<string, unknown>;

export async function runTool(name: string, args: Args): Promise<unknown> {
  const atFen = (typeof args.fen === "string" && args.fen) || fen();
  switch (name) {
    case "get_position":
      return { fen: fen(), color: color(), pgn: actions.toPgn() };

    case "get_legal_moves":
      return { fen: atFen, moves: legalMoves(atFen) };

    case "evaluate_position": {
      const lines = typeof args.lines === "number" ? Math.max(1, Math.min(5, args.lines)) : 3;
      const res = await analyseMulti(atFen, lines);
      if (!res) return { error: "engine offline" };
      return {
        fen: atFen,
        lines: res.map((l) => ({ uci: l.uci, san: moveSan(atFen, l.uci), cp: l.cp, mate: l.mate, depth: l.depth })),
      };
    }

    case "cloud_eval": {
      const c = await cloudEval(atFen);
      return c ? { fen: atFen, ...c } : { fen: atFen, available: false };
    }

    case "propose_line":
      return addSuggestion((args.moves as string[]) ?? [], args.comment as string | undefined);

    default:
      return { error: `unknown tool: ${name}` };
  }
}
