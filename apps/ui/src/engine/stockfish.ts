/**
 * Stockfish (WASM) eval, lazily loaded and fail-soft. The board and move tree never depend on
 * the engine: if stockfish.js fails to load (asset, COEP, unsupported), `analyse` resolves to
 * null and the EvalBar shows "offline". Single-threaded build is fine for an eval bar.
 *
 * Phase 1 scope: one eval at a time, latest-FEN-wins. Depth-search + multipv come with the
 * full engine layer (chess-tools StockfishProvider) in a later phase.
 */
export interface Eval {
  /** Centipawns, white-POV. */
  cp: number | null;
  /** Signed mate distance, white-POV, or null. */
  mate: number | null;
  depth: number;
}

type EngineLike = {
  addMessageListener?: (cb: (line: string) => void) => void;
  postMessage: (cmd: string) => void;
  onmessage?: ((e: MessageEvent | string) => void) | null;
};

let enginePromise: Promise<EngineLike | null> | null = null;
let unavailable = false;
// One persistent line handler, swapped per analyse() call (latest-FEN-wins).
let lineHandler: ((line: string) => void) | null = null;

async function getEngine(): Promise<EngineLike | null> {
  if (unavailable) return null;
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const mod: unknown = await import("stockfish");
        const factory = (mod as { default?: unknown }).default ?? mod;
        const engine =
          typeof factory === "function" ? await (factory as () => Promise<EngineLike>)() : (factory as EngineLike);
        // Register exactly one listener; it forwards to whatever lineHandler is current.
        const route = (line: string) => lineHandler?.(line);
        if (engine.addMessageListener) engine.addMessageListener(route);
        else engine.onmessage = (e: MessageEvent | string) => route(typeof e === "string" ? e : (e.data as string));
        engine.postMessage("uci");
        engine.postMessage("isready");
        return engine;
      } catch (err) {
        console.warn("[engine] stockfish unavailable:", err);
        unavailable = true;
        return null;
      }
    })();
  }
  return enginePromise;
}

const DEPTH = 14;

/** Analyse `fen` to a fixed depth. Resolves null if the engine is unavailable. */
export async function analyse(fen: string): Promise<Eval | null> {
  const engine = await getEngine();
  if (!engine) return null;
  const blackToMove = fen.split(" ")[1] === "b";

  return new Promise<Eval | null>((resolve) => {
    let last: Eval | null = null;
    lineHandler = (line: string) => {
      if (line.startsWith("info") && line.includes(" score ")) {
        const depthM = line.match(/ depth (\d+)/);
        const cpM = line.match(/ score cp (-?\d+)/);
        const mateM = line.match(/ score mate (-?\d+)/);
        const depth = depthM ? Number(depthM[1]) : 0;
        // Engine reports score from side-to-move POV; normalise to white-POV.
        const sign = blackToMove ? -1 : 1;
        last = {
          depth,
          cp: cpM ? sign * Number(cpM[1]) : null,
          mate: mateM ? sign * Number(mateM[1]) : null,
        };
      } else if (line.startsWith("bestmove")) {
        resolve(last);
      }
    };
    engine.postMessage("ucinewgame");
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${DEPTH}`);
  });
}
