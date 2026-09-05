import { fetchJson } from "./apiclient.js";

export interface CloudEval {
  cp: number | null;
  mate: number | null;
  depth: number;
  knodes: number;
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

export async function cloudEval(fen: string, signal?: AbortSignal): Promise<CloudEval | null> {
  const data = await fetchJson<RawCloud>(
    `${URL}?fen=${encodeURIComponent(fen)}&multiPv=1`,
    undefined,
    signal,
  );
  const pv = data?.pvs[0];
  if (!data || !pv) return null;
  return {
    cp: pv.cp ?? null,
    mate: pv.mate ?? null,
    depth: data.depth,
    knodes: data.knodes,
    pv: pv.moves,
  };
}
