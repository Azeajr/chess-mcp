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
import { readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

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
 * In-process eval cache. Key is transposition-friendly (P4): while the halfmove clock is below
 * HALFMOVE_EXACT the key is the first four FEN fields (placement+turn+castling+ep — the same rule
 * as chess-tools' positionKey), so the same position reached by a different move order hits; in
 * opening trees that is the common case. At clock >= HALFMOVE_EXACT the 50-move rule genuinely
 * changes the eval within search horizon, so the full FEN (clocks included) keys exactly. Depth is
 * a *compared value*, not part of the key: a result computed to depth >= the request satisfies
 * that request, so we serve it. FIFO eviction (Map preserves insertion order) at MAX_CACHE.
 * Exported for direct unit testing (hit / depth-miss / eviction) without touching the engine.
 *
 * Persistence (P3): write-through to an append-only JSONL file, loaded at boot, so a new session
 * doesn't re-search the repertoire it analysed yesterday. Evals are position-pure and the
 * depth-reuse rule makes stale-by-depth impossible, so entries never need invalidation. All disk
 * I/O is best-effort: any failure leaves the cache memory-only. `EVAL_CACHE_DIR` overrides the
 * directory (default `$XDG_CACHE_HOME/chess-mcp` or `~/.cache/chess-mcp`); `0` disables.
 */
const MAX_CACHE = 1000;
const HALFMOVE_EXACT = 50;
// Highest MultiPV any tool requests (suggest_* pool) — bounds the cross-multipv cache probe.
const MULTIPV_MAX = 10;

const PERSIST_FILE = (() => {
  const dir =
    process.env.EVAL_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "chess-mcp");
  return dir === "0" ? null : join(dir, "evals.jsonl");
})();

// Serialize all file writes through one chain: appends never interleave, and a compaction
// rewrite can't race an append. First link creates the cache dir.
let writeQueue: Promise<unknown> | null = null;
function queueWrite(fn: () => Promise<unknown>): Promise<void> {
  writeQueue ??= mkdir(dirname(PERSIST_FILE!), { recursive: true });
  writeQueue = writeQueue.then(fn).catch(() => undefined);
  return writeQueue as Promise<void>;
}

type CacheEntry = { depth: number; lines: MultiLine[] };

function persistPut(key: string, entry: CacheEntry): void {
  if (!PERSIST_FILE) return;
  void queueWrite(() =>
    appendFile(PERSIST_FILE, `${JSON.stringify({ k: key, d: entry.depth, l: entry.lines })}\n`),
  );
}

/** Rewrite the JSONL file to exactly the current store (compaction after append-only growth). */
function persistCompact(store: Map<string, CacheEntry>): void {
  if (!PERSIST_FILE) return;
  const body = [...store].map(([k, v]) => JSON.stringify({ k, d: v.depth, l: v.lines })).join("\n");
  void queueWrite(() => writeFile(PERSIST_FILE, body ? `${body}\n` : ""));
}

function loadPersisted(store: Map<string, CacheEntry>): void {
  if (!PERSIST_FILE) return;
  try {
    let fileLines = 0;
    for (const line of readFileSync(PERSIST_FILE, "utf8").split("\n")) {
      if (!line) continue;
      fileLines++;
      try {
        const e = JSON.parse(line) as { k?: unknown; d?: unknown; l?: unknown };
        if (typeof e.k !== "string" || typeof e.d !== "number" || !Array.isArray(e.l)) continue;
        // Delete-then-set so a later (newer) line for the same key takes the newer FIFO slot.
        store.delete(e.k);
        store.set(e.k, { depth: e.d, lines: e.l as MultiLine[] });
      } catch {
        // skip corrupt line
      }
    }
    while (store.size > MAX_CACHE) store.delete(store.keys().next().value!);
    if (fileLines > MAX_CACHE * 2) persistCompact(store);
  } catch {
    // no file yet / unreadable — start memory-only
  }
}

export const evalCache = {
  store: new Map<string, CacheEntry>(),
  key: (fen: string, multipv: number) => {
    const f = fen.split(" ");
    const pos = Number(f[4]) < HALFMOVE_EXACT ? f.slice(0, 4).join(" ") : fen;
    return `${pos}|${multipv}`;
  },
  /** Stored lines iff present and computed to >= depth; else null (miss). */
  get(fen: string, multipv: number, depth: number): MultiLine[] | null {
    const hit = this.store.get(this.key(fen, multipv));
    if (hit && hit.depth >= depth) return hit.lines;
    // Cross-multipv serve: a stored multipv-N result truncated to its top k IS the multipv-k
    // answer at that depth (the lines are the engine's ranking either way) — so a gap scan's
    // multipv-4 entry serves a later multipv-1/2 request at the same position.
    for (let m = multipv + 1; m <= MULTIPV_MAX; m++) {
      const wider = this.store.get(this.key(fen, m));
      if (wider && wider.depth >= depth) return wider.lines.slice(0, multipv);
    }
    return null;
  },
  put(fen: string, multipv: number, depth: number, lines: MultiLine[]): void {
    const key = this.key(fen, multipv);
    const entry: CacheEntry = { depth, lines };
    this.store.set(key, entry);
    if (this.store.size > MAX_CACHE) this.store.delete(this.store.keys().next().value!);
    persistPut(key, entry);
  },
  /** Clears memory only; the disk file is left for the next boot (test hook — see cache.mjs). */
  clear(): void {
    this.store.clear();
  },
  /** Resolves when every queued disk write has settled (test hook). */
  flush(): Promise<void> {
    return Promise.resolve(writeQueue).then(() => undefined);
  },
  /** Drops memory and re-reads the JSONL file — exercises the boot load path (test hook). */
  reload(): void {
    this.store.clear();
    loadPersisted(this.store);
  },
};

loadPersisted(evalCache.store);

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
export function analyseMulti(fen: string, multipv = 1, depth = 16, movetime?: number): Promise<MultiLine[] | null> {
  // movetime is a soft effort target (time, not depth-deterministic) — any cached eval for this
  // position is acceptable (get at depth 0); we store the depth actually reached so depth requests
  // can still reuse it.
  const cached = evalCache.get(fen, multipv, movetime != null ? 0 : depth);
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
          const reached = movetime != null ? result.reduce((m, l) => Math.max(m, l.depth), 0) : depth;
          evalCache.put(fen, multipv, reached, result);
          resolve(result);
        }
      };
      engine.sendCommand("ucinewgame");
      // multipv is a clamped integer (zod min/max); fen is always either chessops-generated
      // (makeFen) or validateFen-gated at the tool boundary — validateFen rejects newlines/garbage,
      // so no caller string can inject extra UCI commands through either interpolation.
      engine.sendCommand(`setoption name MultiPV value ${multipv}`);
      engine.sendCommand(`position fen ${fen}`);
      engine.sendCommand(movetime != null ? `go movetime ${movetime}` : `go depth ${depth}`);
    });
  });
}
