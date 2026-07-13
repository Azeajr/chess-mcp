/**
 * Node-side Stockfish. Primary path (P1): a pool of `stockfish` npm wasm CHILD PROCESSES speaking
 * plain UCI over stdio — parallel searches, per-child wasm heaps, and MCP's JSON-RPC stdout is
 * never shared with engine output. Fallback path (spawn-restricted environments,
 * ENGINE_POOL_SIZE=0): the package's in-process Node loader, with two quirks handled here:
 *   1. Commands go through engine.sendCommand (not postMessage).
 *   2. The build emits UCI output through console.log (emscripten binds `out` to it at init).
 *      We override console.log BEFORE init so that output is captured — and, critically, kept
 *      off real stdout. MCP writes via process.stdout.write and our own logging uses
 *      console.error, so neither is affected.
 *
 * White-POV normalised scores — same contract as the browser engine. The eval cache + in-flight
 * dedupe front both paths; searches are parallel in pool mode, serialized in fallback mode.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { availableParallelism, homedir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

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

// --- engine pool (P1) ---------------------------------------------------------------------------
//
// N Stockfish child processes speaking plain UCI over stdio. child_process, NOT worker_threads:
// the emscripten build's UMD wrapper treats a node worker_thread as a WEB worker (`!isMainThread`
// selects its `self.location` branch), so requiring it there leaves exports empty — but run
// directly under node it has a first-class CLI mode (readline on stdin, output via console.log).
// Children give true OS parallelism, per-child wasm heaps, and free stdout purity: each child's
// stdout is a pipe we consume; MCP JSON-RPC on OUR stdout is untouched.
//
// If the first child fails to spawn (restricted environments), we fall back to the old in-process
// single engine (require("stockfish") + console.log capture), serialized as before. Both paths sit
// behind UciEndpoint so the search/parse/watchdog code is shared.

/** Minimal UCI transport: pool child stdio or the in-process emscripten engine. */
type UciEndpoint = {
  send: (cmd: string) => void;
  setHandler: (h: ((line: string) => void) | null) => void;
};

const WATCHDOG_MS = 30000;
const GRACE_MS = 2000;
const BOOT_MS = 15000;
// Consecutive failed (re)spawns before the pool stops trying (prevents a spawn storm).
const MAX_BOOT_FAILURES = 2;

// ENGINE_POOL_SIZE: 0 forces the in-process fallback (debug knob); otherwise clamped 1-8.
// Default caps at 4 — each child carries a node runtime + wasm heap, and >4 rarely helps
// depth-14 opening searches.
const POOL_SIZE = (() => {
  const env = Number(process.env.ENGINE_POOL_SIZE);
  if (Number.isFinite(env)) return env <= 0 ? 0 : Math.min(8, Math.floor(env));
  return Math.min(availableParallelism(), 4);
})();

/**
 * One search on an endpoint. Watchdog is stop-then-grace (the browser fix, mirrored — closes R1):
 * on timeout send `stop` and resolve on the imminent bestmove with whatever depth was reached;
 * only a truly hung engine trips the grace timer (→ null). `stopped` results are returned but
 * never cached — their reached depth is below what the cache key would claim.
 */
type SearchOutcome = { lines: MultiLine[]; stopped: boolean } | null;

function runSearch(ep: UciEndpoint, fen: string, multipv: number, depth: number, movetime?: number): Promise<SearchOutcome> {
  const sign = fen.split(" ")[1] === "b" ? -1 : 1;
  return new Promise<SearchOutcome>((resolve) => {
    const lines = new Map<number, MultiLine>();
    let stopped = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (out: SearchOutcome) => {
      clearTimeout(wd);
      clearTimeout(graceTimer);
      ep.setHandler(null);
      resolve(out);
    };
    const wd = setTimeout(() => {
      stopped = true;
      ep.send("stop");
      graceTimer = setTimeout(() => finish(null), GRACE_MS);
    }, WATCHDOG_MS);
    ep.setHandler((line: string) => {
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
        finish({ lines: [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v), stopped });
      }
    });
    // multipv is a clamped integer (zod min/max); fen is always either chessops-generated
    // (makeFen) or validateFen-gated at the tool boundary — validateFen rejects newlines/garbage,
    // so no caller string can inject extra UCI commands through either interpolation.
    ep.send(`setoption name MultiPV value ${multipv}`);
    ep.send(`position fen ${fen}`);
    ep.send(movetime != null ? `go movetime ${movetime}` : `go depth ${depth}`);
  });
}

// --- pool children ---

type PoolChild = {
  ep: UciEndpoint;
  child: ChildProcess;
  dead: boolean;
  /** resolves when the process exits (races the in-flight search on a crash). */
  exited: Promise<void>;
};

function enginePath(): string {
  return join(dirname(require.resolve("stockfish/package.json")), "bin", "stockfish-18-lite-single.js");
}

/** Spawn + UCI handshake (uci → uciok, ucinewgame once per child — P2 warmth — isready → readyok). */
function spawnChild(): Promise<PoolChild | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [enginePath()], { stdio: ["pipe", "pipe", "inherit"] });
    } catch (err) {
      console.error("[engine] pool spawn failed:", err);
      resolve(null);
      return;
    }
    let handler: ((line: string) => void) | null = null;
    let buf = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line) handler?.(line);
      }
    });
    let exitResolve!: () => void;
    const exited = new Promise<void>((r) => (exitResolve = r));
    const pc: PoolChild = {
      child,
      dead: false,
      exited,
      ep: {
        send: (cmd) => void child.stdin!.write(`${cmd}\n`),
        setHandler: (h) => (handler = h),
      },
    };
    const fail = () => {
      pc.dead = true;
      exitResolve();
      resolve(null);
    };
    const boot = setTimeout(() => {
      child.kill();
      fail();
    }, BOOT_MS);
    child.on("error", () => {
      clearTimeout(boot);
      fail();
    });
    child.on("exit", () => {
      clearTimeout(boot);
      pc.dead = true;
      exitResolve();
      resolve(null); // no-op if the handshake already resolved
    });
    handler = (line) => {
      if (line.startsWith("uciok")) pc.ep.send("ucinewgame\nisready");
      else if (line.startsWith("readyok")) {
        clearTimeout(boot);
        handler = null;
        resolve(pc);
      }
    };
    pc.ep.send("uci");
  });
}

// --- pool front: queue, dispatch, respawn ---

type Job = {
  fen: string;
  multipv: number;
  depth: number;
  movetime?: number;
  retried: boolean;
  resolve: (out: SearchOutcome) => void;
};

const queue: Job[] = [];
const idle: PoolChild[] = [];
let liveChildren = 0;
let bootFailures = 0;
// null until first use; resolves true = pool mode, false = in-process fallback.
let poolInit: Promise<boolean> | null = null;

/** Idle children don't hold the event loop open (ad-hoc scripts exit naturally after their last
 *  search); a child with a job in flight must. ChildProcess.ref/unref don't cover piped stdio. */
function setIdleRefs(pc: PoolChild, isIdle: boolean): void {
  const m = isIdle ? "unref" : "ref";
  pc.child[m]();
  (pc.child.stdout as unknown as { [k: string]: () => void } | null)?.[m]?.();
  (pc.child.stdin as unknown as { [k: string]: () => void } | null)?.[m]?.();
}

function addChild(pc: PoolChild): void {
  liveChildren++;
  bootFailures = 0;
  void pc.exited.then(() => {
    liveChildren--;
    const i = idle.indexOf(pc);
    if (i >= 0) idle.splice(i, 1);
    if (bootFailures < MAX_BOOT_FAILURES) {
      void spawnChild().then((next) => {
        if (next) {
          addChild(next);
        } else if (++bootFailures >= MAX_BOOT_FAILURES && liveChildren === 0) {
          // Pool is gone for good — fail pending jobs instead of leaving them queued forever.
          for (const job of queue.splice(0)) job.resolve(null);
        }
      });
    } else if (liveChildren === 0) {
      for (const job of queue.splice(0)) job.resolve(null);
    }
  });
  idle.push(pc);
  setIdleRefs(pc, true);
  pump();
}

function pump(): void {
  while (queue.length && idle.length) {
    const job = queue.shift()!;
    const pc = idle.pop()!;
    void runOnChild(pc, job);
  }
}

async function runOnChild(pc: PoolChild, job: Job): Promise<void> {
  setIdleRefs(pc, false);
  const outcome = await Promise.race([
    runSearch(pc.ep, job.fen, job.multipv, job.depth, job.movetime),
    pc.exited.then(() => "died" as const),
  ]);
  if (outcome === "died") {
    // Crash mid-search: requeue once (a transient), fail on the second attempt.
    if (!job.retried) {
      job.retried = true;
      queue.unshift(job);
      pump();
    } else {
      job.resolve(null);
    }
    return;
  }
  if (outcome === null) {
    // Hung past stop+grace: this child is wedged — kill it (exit handler respawns). Don't retry
    // the job; a search that hung 30s will hang again.
    pc.child.kill();
    job.resolve(null);
    return;
  }
  job.resolve(outcome);
  if (!pc.dead) {
    idle.push(pc);
    setIdleRefs(pc, true);
    pump();
  }
}

function poolSearch(fen: string, multipv: number, depth: number, movetime?: number): Promise<SearchOutcome> {
  return new Promise((resolve) => {
    if (liveChildren === 0 && bootFailures >= MAX_BOOT_FAILURES) {
      resolve(null);
      return;
    }
    queue.push({ fen, multipv, depth, movetime, retried: false, resolve });
    pump();
  });
}

/** First child booting decides the mode; the rest of the pool fills in the background. */
function ensurePool(): Promise<boolean> {
  poolInit ??= (async () => {
    if (POOL_SIZE === 0) return false;
    const first = await spawnChild();
    if (!first) {
      console.error("[engine] pool unavailable, falling back to in-process engine");
      return false;
    }
    addChild(first);
    for (let i = 1; i < POOL_SIZE; i++) {
      void spawnChild().then((pc) => {
        if (pc) addChild(pc);
        else bootFailures++;
      });
    }
    return true;
  })();
  return poolInit;
}

// --- in-process fallback (the pre-pool engine, unchanged semantics, searches serialized) ---

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
        const engine = await initEngine(enginePath());
        globalThis.fetch = savedFetch;
        engine.sendCommand("uci");
        // Once per process, NOT per search (P2) — see the pool handshake for the trade-off note.
        engine.sendCommand("ucinewgame");
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

function inProcessSearch(fen: string, multipv: number, depth: number, movetime?: number): Promise<SearchOutcome> {
  return serial(async () => {
    const engine = await getEngine();
    if (!engine) return null;
    const ep: UciEndpoint = {
      send: (cmd) => engine.sendCommand(cmd),
      setHandler: (h) => (lineHandler = h),
    };
    return runSearch(ep, fen, multipv, depth, movetime);
  });
}

// --- public API ---

// In-flight dedupe (R4): two concurrent misses for the same cache key share one search. Depth is
// part of the JOIN condition, not the key — a depth-16 request must not silently adopt a pending
// depth-12 search (mirrors the cache's depth-reuse rule; movetime requests join anything).
const inFlight = new Map<string, { depth: number; promise: Promise<MultiLine[] | null> }>();

/** Top-`multipv` lines for `fen` to `depth`. White-POV cp/mate. null if engine unavailable. */
export function analyseMulti(fen: string, multipv = 1, depth = 16, movetime?: number): Promise<MultiLine[] | null> {
  // movetime is a soft effort target (time, not depth-deterministic) — any cached eval for this
  // position is acceptable (get at depth 0); we store the depth actually reached so depth requests
  // can still reuse it.
  const wanted = movetime != null ? 0 : depth;
  const cached = evalCache.get(fen, multipv, wanted);
  if (cached) return Promise.resolve(cached);
  const key = evalCache.key(fen, multipv);
  const pending = inFlight.get(key);
  if (pending && pending.depth >= wanted) return pending.promise;
  const promise = (async () => {
    const pooled = await ensurePool();
    const outcome = pooled
      ? await poolSearch(fen, multipv, depth, movetime)
      : await inProcessSearch(fen, multipv, depth, movetime);
    if (outcome === null) return null;
    if (!outcome.stopped) {
      const reached = movetime != null ? outcome.lines.reduce((m, l) => Math.max(m, l.depth), 0) : depth;
      evalCache.put(fen, multipv, reached, outcome.lines);
    }
    return outcome.lines;
  })();
  inFlight.set(key, { depth: wanted, promise });
  void promise.finally(() => {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  });
  return promise;
}
