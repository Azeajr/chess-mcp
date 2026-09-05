import { fetchJson } from "./apiclient.js";

export interface TablebaseResult {
  category: "win" | "loss" | "draw" | "cursed-win" | "blessed-loss" | "unknown";
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
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

const TABLEBASE_CATEGORIES = new Set<TablebaseResult["category"]>([
  "win",
  "loss",
  "draw",
  "cursed-win",
  "blessed-loss",
  "unknown",
]);

function isTablebaseCategory(value: string): value is TablebaseResult["category"] {
  return TABLEBASE_CATEGORIES.has(value as TablebaseResult["category"]);
}

export async function tablebaseLookup(
  fen: string,
  signal?: AbortSignal,
): Promise<TablebaseResult | null> {
  const url = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
  const data = await fetchJson<RawTb>(url, undefined, signal);
  if (!data) return null;
  return {
    category: isTablebaseCategory(data.category) ? data.category : "unknown",
    dtz: data.dtz ?? null,
    dtm: data.dtm ?? null,
    checkmate: data.checkmate,
    stalemate: data.stalemate,
    moves: (data.moves ?? []).map((m) => ({
      uci: m.uci,
      san: m.san,
      category: m.category,
      dtz: m.dtz ?? null,
    })),
  };
}
