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
  pv: string[];
}

const MAX_CACHE = 1000;
const HALFMOVE_EXACT = 50;
const MULTIPV_MAX = 10;

const PERSIST_FILE = (() => {
  const dir =
    process.env.EVAL_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "chess-mcp");
  return dir === "0" ? null : join(dir, "evals.jsonl");
})();

let writeQueue: Promise<unknown> | null = null;
function queueWrite(fn: () => Promise<unknown>): Promise<void> {
  if (!PERSIST_FILE) return Promise.resolve();
  writeQueue ??= mkdir(dirname(PERSIST_FILE), { recursive: true });
  writeQueue = writeQueue.then(fn).catch(() => undefined);
  return writeQueue as Promise<void>;
}

interface CacheEntry {
  depth: number;
  lines: MultiLine[];
}

function persistPut(key: string, entry: CacheEntry): void {
  if (!PERSIST_FILE) return;
  void queueWrite(() =>
    appendFile(PERSIST_FILE, `${JSON.stringify({ k: key, d: entry.depth, l: entry.lines })}\n`),
  );
}

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
        store.delete(e.k);
        store.set(e.k, { depth: e.d, lines: e.l as MultiLine[] });
      } catch {
        // skip corrupt line
      }
    }
    while (store.size > MAX_CACHE) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
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
  get(fen: string, multipv: number, depth: number): MultiLine[] | null {
    const hit = this.store.get(this.key(fen, multipv));
    if (hit && hit.depth >= depth) return hit.lines;
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
    if (this.store.size > MAX_CACHE) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    persistPut(key, entry);
  },
  clear(): void {
    this.store.clear();
  },
  flush(): Promise<void> {
    return Promise.resolve(writeQueue).then(() => undefined);
  },
  reload(): void {
    this.store.clear();
    loadPersisted(this.store);
  },
};

loadPersisted(evalCache.store);

interface UciEndpoint {
  send: (cmd: string) => void;
  setHandler: (h: ((line: string) => void) | null) => void;
}

const WATCHDOG_MS = 30000;
const DEEP_WATCHDOG_MS = 60000;
const GRACE_MS = 2000;
const BOOT_MS = 15000;
const MAX_BOOT_FAILURES = 2;

const POOL_SIZE = (() => {
  const env = Number(process.env.ENGINE_POOL_SIZE);
  if (Number.isFinite(env)) return env <= 0 ? 0 : Math.min(8, Math.floor(env));
  return Math.min(availableParallelism(), 4);
})();

type SearchOutcome = { lines: MultiLine[]; stopped: boolean } | null;

function runSearch(
  ep: UciEndpoint,
  fen: string,
  multipv: number,
  depth: number,
  movetime?: number,
): Promise<SearchOutcome> {
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
    const wd = setTimeout(
      () => {
        stopped = true;
        ep.send("stop");
        graceTimer = setTimeout(() => {
          finish(null);
        }, GRACE_MS);
      },
      movetime == null && depth >= 30 ? DEEP_WATCHDOG_MS : WATCHDOG_MS,
    );
    ep.setHandler((line: string) => {
      if (line.startsWith("info") && line.includes(" multipv ") && line.includes(" pv ")) {
        const idx = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 0);
        const d = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
        const cp = / score cp (-?\d+)/.exec(line);
        const mate = / score mate (-?\d+)/.exec(line);
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
        finish({
          lines: [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
          stopped,
        });
      }
    });
    ep.send(`setoption name MultiPV value ${multipv}`);
    ep.send(`position fen ${fen}`);
    ep.send(movetime != null ? `go movetime ${movetime}` : `go depth ${depth}`);
  });
}

interface PoolChild {
  ep: UciEndpoint;
  child: ChildProcess;
  dead: boolean;
  exited: Promise<void>;
}

function enginePath(): string {
  return join(
    dirname(require.resolve("stockfish/package.json")),
    "bin",
    "stockfish-18-lite-single.js",
  );
}

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
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
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
        send: (cmd) => void child.stdin?.write(`${cmd}\n`),
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
      resolve(null);
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

interface Job {
  fen: string;
  multipv: number;
  depth: number;
  movetime?: number;
  retried: boolean;
  resolve: (out: SearchOutcome) => void;
}

const queue: Job[] = [];
const idle: PoolChild[] = [];
let liveChildren = 0;
let bootFailures = 0;
let poolInit: Promise<boolean> | null = null;

function setIdleRefs(pc: PoolChild, isIdle: boolean): void {
  const m = isIdle ? "unref" : "ref";
  pc.child[m]();
  (pc.child.stdout as unknown as Record<string, () => void> | null)?.[m]?.();
  (pc.child.stdin as unknown as Record<string, () => void> | null)?.[m]?.();
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
    const job = queue.shift();
    const pc = idle.pop();
    if (!job || !pc) break;
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

function poolSearch(
  fen: string,
  multipv: number,
  depth: number,
  movetime?: number,
): Promise<SearchOutcome> {
  return new Promise((resolve) => {
    if (liveChildren === 0 && bootFailures >= MAX_BOOT_FAILURES) {
      resolve(null);
      return;
    }
    queue.push({ fen, multipv, depth, movetime, retried: false, resolve });
    pump();
  });
}

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

interface Engine {
  sendCommand: (cmd: string) => void;
}

let enginePromise: Promise<Engine | null> | null = null;
let lineHandler: ((line: string) => void) | null = null;
let captureInstalled = false;

function installCapture() {
  if (captureInstalled) return;
  captureInstalled = true;
  // eslint-disable-next-line no-console -- Stockfish's in-process Emscripten fallback emits UCI here.
  console.log = (...args: unknown[]) => {
    lineHandler?.(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
}

async function getEngine(): Promise<Engine | null> {
  enginePromise ??= (async () => {
    try {
      installCapture();
      const savedFetch = globalThis.fetch;
      const initEngine = require("stockfish") as (path: string) => Promise<Engine>;
      const engine = await initEngine(enginePath());
      globalThis.fetch = savedFetch;
      engine.sendCommand("uci");
      engine.sendCommand("ucinewgame");
      engine.sendCommand("isready");
      return engine;
    } catch (err) {
      console.error("[engine] stockfish unavailable:", err);
      return null;
    }
  })();
  return enginePromise;
}

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function inProcessSearch(
  fen: string,
  multipv: number,
  depth: number,
  movetime?: number,
): Promise<SearchOutcome> {
  return serial(async () => {
    const engine = await getEngine();
    if (!engine) return null;
    const ep: UciEndpoint = {
      send: (cmd) => {
        engine.sendCommand(cmd);
      },
      setHandler: (h) => (lineHandler = h),
    };
    const outcome = await runSearch(ep, fen, multipv, depth, movetime);
    if (outcome === null) {
      try {
        engine.sendCommand("quit");
      } catch {
        /* best effort */
      }
      enginePromise = null;
    }
    return outcome;
  });
}

const inFlight = new Map<string, { depth: number; promise: Promise<MultiLine[] | null> }>();

export function analyseMulti(
  fen: string,
  multipv = 1,
  depth = 20,
  movetime?: number,
): Promise<MultiLine[] | null> {
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
      const reached =
        movetime != null ? outcome.lines.reduce((m, l) => Math.max(m, l.depth), 0) : depth;
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
