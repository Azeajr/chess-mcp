/**
 * Stockfish (WASM) eval, lazily loaded and fail-soft. The board and move tree never depend on
 * the engine: if stockfish.js fails to load (asset, COEP, unsupported), `analyse` resolves to
 * null and the EvalBar shows "offline". Single-threaded build is fine for an eval bar.
 *
 * Phase 1 scope: one eval at a time, latest-FEN-wins. Depth-search + multipv come with the
 * full engine layer (chess-tools StockfishProvider) in a later phase.
 */
import { idbGet, idbSet } from "../store/idb";

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
  /** full principal variation, UCI moves. */
  pv: string[];
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
        // Once per worker, NOT per search (P2): a warm TT carries the previous search's work into
        // the next near-identical position — repertoire scans get a real same-depth speedup. Node
        // counts / tie-break lines may vary run-to-run as a result (same class as movetime).
        worker.postMessage("ucinewgame");
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

// Eval cache for analyseMulti (the heavy, repeated work: gaps / shorten / bridges / complementary
// scans). Mirrors the MCP engine cache. Depth is a compared value (a result computed to >= the
// request satisfies it). movetime requests compare at depth 0 (time-based, non-deterministic — any
// prior result for that key serves). The single-PV live `analyse` is intentionally NOT cached: the
// eval bar wants a fresh streaming search. FIFO eviction at MAX_CACHE.
//
// Key (P4): while the halfmove clock is < 50 the key is the first four FEN fields (same rule as
// chess-tools' positionKey), so transpositions — same position, different move counters — hit.
// At clock >= 50 the 50-move rule genuinely affects the eval, so the full FEN keys exactly.
const MAX_CACHE = 1000;
// Highest MultiPV any tool requests — bounds the cross-multipv cache probe.
const MULTIPV_MAX = 10;
const multiCache = new Map<string, { depth: number; lines: MultiLine[] }>();
const cacheKey = (fen: string, multipv: number) => {
  const f = fen.split(" ");
  const pos = Number(f[4]) < 50 ? f.slice(0, 4).join(" ") : fen;
  return `${pos}|${multipv}`;
};

/** Cached lines iff stored to >= depth; a stored multipv-N result truncated to its top k IS the
 *  multipv-k answer at that depth, so wider entries serve narrower requests (mirrors the Node cache). */
function cacheGet(fen: string, multipv: number, depth: number): MultiLine[] | null {
  const exact = multiCache.get(cacheKey(fen, multipv));
  if (exact && exact.depth >= depth) return exact.lines;
  for (let m = multipv + 1; m <= MULTIPV_MAX; m++) {
    const wider = multiCache.get(cacheKey(fen, m));
    if (wider && wider.depth >= depth) return wider.lines.slice(0, multipv);
  }
  return null;
}

// P3 — persist multiCache to IndexedDB so a reload doesn't re-search the same repertoire. Loaded
// once at module init (misses during the async load just search as before), written back debounced
// after cache inserts. Evals are position-pure and depth-reuse handles shallower stored results, so
// entries never need invalidation. Best-effort: any IndexedDB failure leaves the cache memory-only.
const PERSIST_KEY = "engineEvals";
let persistTimer: ReturnType<typeof setTimeout> | undefined;

void (async () => {
  try {
    const saved = await idbGet<[string, { depth: number; lines: MultiLine[] }][]>(PERSIST_KEY);
    if (!Array.isArray(saved)) return;
    for (const [k, v] of saved) {
      if (typeof k !== "string" || typeof v?.depth !== "number" || !Array.isArray(v?.lines)) continue;
      // Don't clobber a result computed while the load was in flight.
      if (!multiCache.has(k)) multiCache.set(k, v);
    }
    while (multiCache.size > MAX_CACHE) multiCache.delete(multiCache.keys().next().value!);
  } catch {
    // memory-only
  }
})();

function schedulePersist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    idbSet(PERSIST_KEY, [...multiCache]).catch(() => undefined);
  }, 1500);
}

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
    // Watchdog: abort THIS search only (send "stop" → the imminent bestmove resolves with whatever
    // depth was reached). Marking the engine unavailable here would brick it for the whole session on
    // one slow search; only a worker error (getEngine) means it's really gone. The grace timer covers
    // a truly hung worker — and must NOT resolve early otherwise, or the serial chain would drive an
    // overlapping `go` at the still-searching Worker (which traps the wasm).
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const wd = setTimeout(() => {
      engine.postMessage("stop");
      graceTimer = setTimeout(() => resolve(last), 2000);
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
        clearTimeout(graceTimer);
        resolve(last);
      }
    };
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
export function analyseMulti(fen: string, multipv: number, depth = DEPTH, movetime?: number): Promise<MultiLine[] | null> {
  const hit = cacheGet(fen, multipv, movetime != null ? 0 : depth);
  if (hit) return Promise.resolve(hit);
  return serial(async () => {
    const engine = await getEngine();
    if (!engine) return null;
    const blackToMove = fen.split(" ")[1] === "b";
    const sign = blackToMove ? -1 : 1;

    return new Promise<MultiLine[] | null>((resolve) => {
    const lines = new Map<number, MultiLine>();
    // Per-search watchdog only — same stop-then-grace shape as analyse(): never poison the engine for
    // the session, never resolve while the Worker may still be searching. A stopped search's partial
    // result is returned but NOT cached (its reached depth is below what the key would claim).
    let stopped = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const wd = setTimeout(() => {
      stopped = true;
      engine.postMessage("stop");
      graceTimer = setTimeout(() => resolve(null), 2000);
    }, WATCHDOG_MS);
    lineHandler = (line: string) => {
      if (line.startsWith("info") && line.includes(" multipv ") && line.includes(" pv ")) {
        const pvIdx = Number(line.match(/ multipv (\d+)/)?.[1] ?? 0);
        const depth = Number(line.match(/ depth (\d+)/)?.[1] ?? 0);
        const cpM = line.match(/ score cp (-?\d+)/);
        const mateM = line.match(/ score mate (-?\d+)/);
        const pvStr = line.split(" pv ")[1];
        const pv = pvStr ? pvStr.trim().split(/\s+/) : [];
        const firstMove = pv[0];
        if (!pvIdx || !firstMove) return;
        lines.set(pvIdx, {
          uci: firstMove,
          pv,
          depth,
          cp: cpM ? sign * Number(cpM[1]) : null,
          mate: mateM ? sign * Number(mateM[1]) : null,
        });
      } else if (line.startsWith("bestmove")) {
        clearTimeout(wd);
        clearTimeout(graceTimer);
        const result = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
        if (result.length && !stopped) {
          // Store the depth actually reached (like the Node engine cache) so a movetime result can
          // still serve later depth requests it satisfies.
          const reached = movetime != null ? result.reduce((m, l) => Math.max(m, l.depth), 0) : depth;
          multiCache.set(cacheKey(fen, multipv), { depth: reached, lines: result });
          if (multiCache.size > MAX_CACHE) multiCache.delete(multiCache.keys().next().value!);
          schedulePersist();
        }
        resolve(result);
      }
    };
      engine.postMessage(`setoption name MultiPV value ${multipv}`);
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(movetime != null ? `go movetime ${movetime}` : `go depth ${depth}`);
    });
  });
}
