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

export const FOOLS_MATE_FEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

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

export const AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

export const AFTER_E4_E5_FEN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

export const ITALIAN_FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";

export const KINGLESS_FEN = "8/8/8/4q3/8/8/8/8 w - - 0 1";

export const MALFORMED_FEN = "not a fen";
