/**
 * Lichess cloud evaluation lookup (port of the Python cloud_eval tool). Returns a community
 * cloud eval for positions Lichess has analysed, or null on a miss / offline. cp and mate are
 * white-POV (verified: a position with Black to move where White is better reports positive cp).
 */
import { fetchJson } from "./apiclient.js";

export interface CloudEval {
  /** white-POV centipawns, or null when mate is set. */
  cp: number | null;
  /** white-POV signed mate distance, or null. */
  mate: number | null;
  depth: number;
  knodes: number;
  /** principal variation, space-separated UCI moves. */
  pv: string;
}

interface RawPv {
  moves: string;
  cp?: number;
  mate?: number;
}
interface RawCloud {
  depth: number;
  knodes: number;
  pvs: RawPv[];
}

const URL = "https://lichess.org/api/cloud-eval";

export async function cloudEval(fen: string): Promise<CloudEval | null> {
  const data = await fetchJson<RawCloud>(`${URL}?fen=${encodeURIComponent(fen)}&multiPv=1`);
  const pv = data?.pvs?.[0];
  if (!data || !pv) return null;
  return {
    cp: pv.cp ?? null,
    mate: pv.mate ?? null,
    depth: data.depth,
    knodes: data.knodes,
    pv: pv.moves,
  };
}
