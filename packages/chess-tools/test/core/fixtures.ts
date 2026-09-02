/**
 * Positions shared by the core module suites. Every FEN here was produced and confirmed legal by
 * this repo's own MCP server (`validate_fen` / `get_legal_moves`) rather than written by hand, so
 * the expectations below are the library's own answers, not a guess about chess.
 */

/** Standard initial position. `get_legal_moves` reports exactly the twenty replies below. */
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const START_LEGAL_MOVES = [
  "Na3",
  "Nc3",
  "Nf3",
  "Nh3",
  "a3",
  "a4",
  "b3",
  "b4",
  "c3",
  "c4",
  "d3",
  "d4",
  "e3",
  "e4",
  "f3",
  "f4",
  "g3",
  "g4",
  "h3",
  "h4",
] as const;

/**
 * Fool's Mate, after 1. f3 e5 2. g4 Qh4#. White is to move, is in check, and has no legal reply —
 * `get_legal_moves` returns an empty list here, which is mate rather than a lookup failure. Useful
 * for check detection and for the empty-legal-move edge at the same time.
 */
export const FOOLS_MATE_FEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

/**
 * White pawn on a7 with both kings clear of it. `get_legal_moves` lists eight king moves plus
 * `a8=Q` — one promotion, not four, because the library reports pawn promotions as queen
 * promotions only.
 */
export const PROMOTION_FEN = "8/P6k/8/8/8/8/6K1/8 w - - 0 1";

export const PROMOTION_LEGAL_MOVES = [
  "Kf1",
  "Kg1",
  "Kh1",
  "Kf2",
  "Kh2",
  "Kf3",
  "Kg3",
  "Kh3",
  "a8=Q",
] as const;

/** Syntactically well-formed but not a position any legal game reaches: no kings on the board. */
export const KINGLESS_FEN = "8/8/8/4q3/8/8/8/8 w - - 0 1";

/** Not a FEN at all. */
export const MALFORMED_FEN = "not a fen";
