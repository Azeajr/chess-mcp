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

export interface MultiLine extends Eval {
  /** First move of the line, UCI. */
  uci: string;
}

type EngineLike = { postMessage: (cmd: string) => void };

// Single-threaded browser build, copied to /engine/ by scripts/copy-engine.mjs (predev).
const ENGINE_URL = "/engine/stockfish-18-lite-single.js";
// If a search produces no bestmove within this window, treat the engine as unavailable.
const WATCHDOG_MS = 20000;

let enginePromise: Promise<EngineLike | null> | null = null;
let unavailable = false;
// One persistent line handler, swapped per analyse() call (latest-FEN-wins).
let lineHandler: ((line: string) => void) | null = null;

async function getEngine(): Promise<EngineLike | null> {
  if (unavailable) return null;
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const worker = new Worker(ENGINE_URL);
        worker.onmessage = (e: MessageEvent) => {
          const data = e.data as unknown;
          lineHandler?.(typeof data === "string" ? data : String(data));
        };
        worker.onerror = (e) => {
          console.warn("[engine] worker error:", e.message);
          unavailable = true;
        };
        worker.postMessage("uci");
        worker.postMessage("isready");
        return { postMessage: (cmd: string) => worker.postMessage(cmd) } satisfies EngineLike;
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

// One engine, one search at a time. Every search runs through this chain so two consumers
// (eval bar, analysis panel) never drive overlapping `go` commands at the shared Worker —
// which traps the wasm. Latest-wins debouncing happens above; this just serialises.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** Analyse `fen` to a fixed depth. Resolves null if the engine is unavailable. */
export function analyse(fen: string): Promise<Eval | null> {
  return serial(async () => {
    const engine = await getEngine();
    if (!engine) return null;
    const blackToMove = fen.split(" ")[1] === "b";

    return new Promise<Eval | null>((resolve) => {
    let last: Eval | null = null;
    const wd = setTimeout(() => {
      unavailable = true;
      resolve(null);
    }, WATCHDOG_MS);
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
        clearTimeout(wd);
        resolve(last);
      }
    };
      engine.postMessage("ucinewgame");
      engine.postMessage("setoption name MultiPV value 1");
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`go depth ${DEPTH}`);
    });
  });
}

/**
 * Top-`multipv` lines for `fen` to a fixed depth. Each line carries its first move (UCI) and
 * the white-POV score. Resolves null if the engine is unavailable.
 */
export function analyseMulti(fen: string, multipv: number): Promise<MultiLine[] | null> {
  return serial(async () => {
    const engine = await getEngine();
    if (!engine) return null;
    const blackToMove = fen.split(" ")[1] === "b";
    const sign = blackToMove ? -1 : 1;

    return new Promise<MultiLine[] | null>((resolve) => {
    const lines = new Map<number, MultiLine>();
    const wd = setTimeout(() => {
      unavailable = true;
      resolve(null);
    }, WATCHDOG_MS);
    lineHandler = (line: string) => {
      if (line.startsWith("info") && line.includes(" multipv ") && line.includes(" pv ")) {
        const pvIdx = Number(line.match(/ multipv (\d+)/)?.[1] ?? 0);
        const depth = Number(line.match(/ depth (\d+)/)?.[1] ?? 0);
        const cpM = line.match(/ score cp (-?\d+)/);
        const mateM = line.match(/ score mate (-?\d+)/);
        const firstMove = line.match(/ pv (\S+)/)?.[1];
        if (!pvIdx || !firstMove) return;
        lines.set(pvIdx, {
          uci: firstMove,
          depth,
          cp: cpM ? sign * Number(cpM[1]) : null,
          mate: mateM ? sign * Number(mateM[1]) : null,
        });
      } else if (line.startsWith("bestmove")) {
        clearTimeout(wd);
        resolve([...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v));
      }
    };
      engine.postMessage("ucinewgame");
      engine.postMessage(`setoption name MultiPV value ${multipv}`);
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`go depth ${DEPTH}`);
    });
  });
}
