/**
 * Lichess tablebase lookup (port of the Python tablebase_lookup tool). Exact result for
 * positions with ≤7 pieces, or null on a miss / offline / too many pieces.
 */
import { fetchJson } from "./apiclient.js";

export interface TablebaseResult {
  category: "win" | "loss" | "draw" | "cursed-win" | "blessed-loss" | "unknown";
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  /** best moves, sorted by the API (UCI + resulting category). */
  moves: { uci: string; san: string; category: string; dtz: number | null }[];
}

interface RawMove {
  uci: string;
  san: string;
  category: string;
  dtz: number | null;
}
interface RawTb {
  category: string;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  moves?: RawMove[];
}

export async function tablebaseLookup(fen: string): Promise<TablebaseResult | null> {
  const url = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
  const data = await fetchJson<RawTb>(url);
  if (!data) return null;
  return {
    category: (data.category as TablebaseResult["category"]) ?? "unknown",
    dtz: data.dtz ?? null,
    dtm: data.dtm ?? null,
    checkmate: !!data.checkmate,
    stalemate: !!data.stalemate,
    moves: (data.moves ?? []).map((m) => ({ uci: m.uci, san: m.san, category: m.category, dtz: m.dtz ?? null })),
  };
}
