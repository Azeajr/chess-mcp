/**
 * Node-side Stockfish via the `stockfish` npm package (its native Node loader). Two Node-specific
 * quirks handled here:
 *   1. Commands go through engine.sendCommand (not postMessage).
 *   2. The build emits UCI output through console.log (emscripten binds `out` to it at init).
 *      We override console.log BEFORE init so that output is captured — and, critically, kept
 *      off real stdout, which the MCP server uses for JSON-RPC. MCP writes via
 *      process.stdout.write and our own logging uses console.error, so neither is affected.
 *
 * White-POV normalised scores + serialized searches — same contract as the browser engine.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export interface MultiLine {
  uci: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  /** full principal variation, UCI moves. */
  pv: string[];
}

/**
 * In-process eval cache (per Claude Code session — the engine lives in-process, so does this).
 * Key is `${fen}|${multipv}` (full FEN incl. clock — Stockfish sees the clock at engine.ts'
 * `position fen`, and it matters near the 50-move rule). Depth is a *compared value*, not part of
 * the key: a result computed to depth >= the request satisfies that request, so we serve it. FIFO
 * eviction (Map preserves insertion order) at MAX_CACHE; eviction rarely fires within one session.
 * Exported for direct unit testing (hit / depth-miss / eviction) without touching the engine.
 */
const MAX_CACHE = 1000;
export const evalCache = {
  store: new Map<string, { depth: number; lines: MultiLine[] }>(),
  key: (fen: string, multipv: number) => `${fen}|${multipv}`,
  /** Stored lines iff present and computed to >= depth; else null (miss). */
  get(fen: string, multipv: number, depth: number): MultiLine[] | null {
    const hit = this.store.get(this.key(fen, multipv));
    return hit && hit.depth >= depth ? hit.lines : null;
  },
  put(fen: string, multipv: number, depth: number, lines: MultiLine[]): void {
    this.store.set(this.key(fen, multipv), { depth, lines });
    if (this.store.size > MAX_CACHE) this.store.delete(this.store.keys().next().value!);
  },
  clear(): void {
    this.store.clear();
  },
};

type Engine = { sendCommand: (cmd: string) => void };

let enginePromise: Promise<Engine | null> | null = null;
let lineHandler: ((line: string) => void) | null = null;
let captureInstalled = false;

function installCapture() {
  if (captureInstalled) return;
  captureInstalled = true;
  // Route engine stdout (console.log) to the current line handler; swallow it otherwise.
  console.log = (...args: unknown[]) => {
    lineHandler?.(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
}

async function getEngine(): Promise<Engine | null> {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        installCapture();
        // The emscripten build clobbers globalThis.fetch (its browser asset loader) during init.
        // Save Node's real fetch and restore it after, so the network tools keep working.
        const savedFetch = globalThis.fetch;
        const initEngine = require("stockfish") as (path: string) => Promise<Engine>;
        const binDir = join(dirname(require.resolve("stockfish/package.json")), "bin");
        const engine = await initEngine(join(binDir, "stockfish-18-lite-single.js"));
        globalThis.fetch = savedFetch;
        engine.sendCommand("uci");
        engine.sendCommand("isready");
        return engine;
      } catch (err) {
        console.error("[engine] stockfish unavailable:", err);
        return null;
      }
    })();
  }
  return enginePromise;
}

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** Top-`multipv` lines for `fen` to `depth`. White-POV cp/mate. null if engine unavailable. */
export function analyseMulti(fen: string, multipv = 1, depth = 16): Promise<MultiLine[] | null> {
  const cached = evalCache.get(fen, multipv, depth);
  if (cached) return Promise.resolve(cached);
  return serial(async () => {
    const engine = await getEngine();
    if (!engine) return null;
    const sign = fen.split(" ")[1] === "b" ? -1 : 1;
    return new Promise<MultiLine[] | null>((resolve) => {
      const lines = new Map<number, MultiLine>();
      const wd = setTimeout(() => resolve(null), 30000);
      lineHandler = (line: string) => {
        if (line.startsWith("info") && line.includes(" multipv ") && line.includes(" pv ")) {
          const idx = Number(line.match(/ multipv (\d+)/)?.[1] ?? 0);
          const d = Number(line.match(/ depth (\d+)/)?.[1] ?? 0);
          const cp = line.match(/ score cp (-?\d+)/);
          const mate = line.match(/ score mate (-?\d+)/);
          const pvStr = line.split(" pv ")[1];
          const pv = pvStr ? pvStr.trim().split(/\s+/) : [];
          if (!idx || !pv[0]) return;
          lines.set(idx, {
            uci: pv[0],
            pv,
            depth: d,
            cp: cp ? sign * Number(cp[1]) : null,
            mate: mate ? sign * Number(mate[1]) : null,
          });
        } else if (line.startsWith("bestmove")) {
          clearTimeout(wd);
          const result = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
          evalCache.put(fen, multipv, depth, result);
          resolve(result);
        }
      };
      engine.sendCommand("ucinewgame");
      engine.sendCommand(`setoption name MultiPV value ${multipv}`);
      engine.sendCommand(`position fen ${fen}`);
      engine.sendCommand(`go depth ${depth}`);
    });
  });
}
