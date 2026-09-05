import { idbGet, idbSet } from "../store/idb";

export interface Eval {
  cp: number | null;
  mate: number | null;
  depth: number;
}

export interface MultiLine extends Eval {
  uci: string;
  pv: string[];
}

const ENGINE_URL = "/engine/stockfish-18-lite-single.js";
const WATCHDOG_MS = 20000;
const DEEP_WATCHDOG_MS = 60000;
const GRACE_MS = 2000;
const DEPTH = 20;

const POOL_BUDGET = Math.min(
  (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2,
  5,
);
const POOL_SIZE = Math.max(1, POOL_BUDGET - 1);
const MAX_BOOT_FAILURES = 2;

const MAX_CACHE = 1000;
const MULTIPV_MAX = 10;
const multiCache = new Map<string, { depth: number; lines: MultiLine[] }>();
const cacheKey = (fen: string, multipv: number) => {
  const f = fen.split(" ");
  const pos = Number(f[4]) < 50 ? f.slice(0, 4).join(" ") : fen;
  return `${pos}|${multipv}`;
};

function cacheGet(fen: string, multipv: number, depth: number): MultiLine[] | null {
  const exact = multiCache.get(cacheKey(fen, multipv));
  if (exact && exact.depth >= depth) return exact.lines;
  for (let m = multipv + 1; m <= MULTIPV_MAX; m++) {
    const wider = multiCache.get(cacheKey(fen, m));
    if (wider && wider.depth >= depth) return wider.lines.slice(0, multipv);
  }
  return null;
}

function cachePut(fen: string, multipv: number, depth: number, lines: MultiLine[]): void {
  multiCache.set(cacheKey(fen, multipv), { depth, lines });
  if (multiCache.size > MAX_CACHE) {
    const oldestKey = multiCache.keys().next().value;
    if (oldestKey !== undefined) multiCache.delete(oldestKey);
  }
  schedulePersist();
}

const PERSIST_KEY = "engineEvals";
let persistTimer: ReturnType<typeof setTimeout> | undefined;

void (async () => {
  try {
    const saved = await idbGet<[string, { depth: number; lines: MultiLine[] }][]>(PERSIST_KEY);
    if (!Array.isArray(saved)) return;
    for (const [k, v] of saved) {
      if (typeof k !== "string" || typeof v.depth !== "number" || !Array.isArray(v.lines)) continue;
      if (!multiCache.has(k)) multiCache.set(k, v);
    }
    while (multiCache.size > MAX_CACHE) {
      const oldestKey = multiCache.keys().next().value;
      if (oldestKey === undefined) break;
      multiCache.delete(oldestKey);
    }
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

interface WorkerEndpoint {
  post: (cmd: string) => void;
  setHandler: (h: ((line: string) => void) | null) => void;
  terminate: () => void;
  dead: boolean;
  died: Promise<void>;
}

let unavailable = false;

function spawnWorker(): WorkerEndpoint | null {
  if (unavailable) return null;
  try {
    const worker = new Worker(ENGINE_URL);
    let handler: ((line: string) => void) | null = null;
    let markDead!: () => void;
    const died = new Promise<void>((r) => (markDead = r));
    const ep: WorkerEndpoint = {
      post: (cmd) => {
        worker.postMessage(cmd);
      },
      setHandler: (h) => (handler = h),
      terminate: () => {
        if (ep.dead) return;
        ep.dead = true;
        worker.terminate();
        markDead();
      },
      dead: false,
      died,
    };
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as unknown;
      handler?.(typeof data === "string" ? data : String(data));
    };
    worker.onerror = (e) => {
      console.warn("[engine] worker error:", e.message);
      ep.dead = true;
      markDead();
    };
    worker.postMessage("uci");
    worker.postMessage("ucinewgame");
    worker.postMessage("isready");
    return ep;
  } catch (err) {
    console.warn("[engine] stockfish unavailable:", err);
    unavailable = true;
    return null;
  }
}

type SearchOutcome = { lines: MultiLine[]; stopped: boolean } | null;

function runSearch(
  ep: WorkerEndpoint,
  fen: string,
  multipv: number,
  depth: number,
  movetime?: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const sign = fen.split(" ")[1] === "b" ? -1 : 1;
  return new Promise<SearchOutcome>((resolve) => {
    const lines = new Map<number, MultiLine>();
    let stopped = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (out: SearchOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(wd);
      clearTimeout(graceTimer);
      signal?.removeEventListener("abort", stop);
      ep.setHandler(null);
      resolve(out);
    };
    void ep.died.then(() => {
      finish(null);
    });
    const stop = () => {
      if (settled || stopped) return;
      stopped = true;
      ep.post("stop");
      graceTimer = setTimeout(() => {
        finish(null);
      }, GRACE_MS);
    };
    const wd = setTimeout(
      () => {
        stop();
      },
      movetime == null && depth >= 30 ? DEEP_WATCHDOG_MS : WATCHDOG_MS,
    );
    signal?.addEventListener("abort", stop, { once: true });
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
    if (signal?.aborted) {
      finish({ lines: [], stopped: true });
      return;
    }
    ep.post(`setoption name MultiPV value ${multipv}`);
    ep.post(`position fen ${fen}`);
    ep.post(movetime != null ? `go movetime ${movetime}` : `go depth ${depth}`);
  });
}

interface Job {
  id: number;
  fen: string;
  multipv: number;
  depth: number;
  movetime?: number;
  retried: boolean;
  resolve: (out: SearchOutcome) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  cleanup?: () => void;
}

const queue: Job[] = [];
const idle: WorkerEndpoint[] = [];
let livePool = 0;
let bootFailures = 0;
let poolStarted = false;
let nextJobId = 1;
const abortError = () => new DOMException("Cancelled", "AbortError");

function queueJob(job: Job, front = false): void {
  if (job.signal?.aborted) {
    job.reject(abortError());
    return;
  }
  const cancelQueued = () => {
    const index = queue.indexOf(job);
    if (index < 0) return;
    queue.splice(index, 1);
    job.cleanup?.();
    job.reject(abortError());
  };
  if (job.signal) {
    job.signal.addEventListener("abort", cancelQueued, { once: true });
    job.cleanup = () => job.signal?.removeEventListener("abort", cancelQueued);
  }
  if (front) queue.unshift(job);
  else queue.push(job);
}

function addPoolWorker(ep: WorkerEndpoint): void {
  livePool++;
  bootFailures = 0;
  void ep.died.then(() => {
    livePool--;
    const i = idle.indexOf(ep);
    if (i >= 0) idle.splice(i, 1);
    if (!unavailable && bootFailures < MAX_BOOT_FAILURES) {
      const next = spawnWorker();
      if (next) {
        addPoolWorker(next);
        return;
      }
      bootFailures++;
    }
    if (livePool === 0)
      for (const job of queue.splice(0)) {
        job.cleanup?.();
        job.resolve(null);
      }
  });
  idle.push(ep);
  pump();
}

function pump(): void {
  while (queue.length && idle.length) {
    const job = queue.shift();
    if (job === undefined) return;
    job.cleanup?.();
    const ep = idle.pop();
    if (ep === undefined) return;
    void runOnWorker(ep, job);
  }
}

async function runOnWorker(ep: WorkerEndpoint, job: Job): Promise<void> {
  const outcome = await Promise.race([
    runSearch(ep, job.fen, job.multipv, job.depth, job.movetime, job.signal),
    ep.died.then(() => "died" as const),
  ]);
  if (outcome === "died") {
    if (!job.retried) {
      job.retried = true;
      queueJob(job, true);
      pump();
    } else {
      job.resolve(null);
    }
    return;
  }
  if (outcome === null) {
    ep.terminate();
    job.resolve(null);
    return;
  }
  job.resolve(outcome);
  if (!ep.dead) {
    idle.push(ep);
    pump();
  }
}

function ensurePool(): boolean {
  if (!poolStarted) {
    poolStarted = true;
    for (let i = 0; i < POOL_SIZE; i++) {
      const ep = spawnWorker();
      if (!ep) break;
      addPoolWorker(ep);
    }
  }
  return livePool > 0;
}

function poolSearch(
  fen: string,
  multipv: number,
  depth: number,
  movetime?: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const job: Job = {
      id: nextJobId++,
      fen,
      multipv,
      depth,
      movetime,
      retried: false,
      resolve,
      reject,
      signal,
    };
    queueJob(job);
    pump();
  });
}

interface InFlight {
  depth: number;
  controller: AbortController;
  promise: Promise<MultiLine[] | null>;
  subscribers: number;
  settled: boolean;
}
const inFlight = new Map<string, InFlight>();

function subscribe(entry: InFlight, signal?: AbortSignal): Promise<MultiLine[] | null> {
  entry.subscribers++;
  return new Promise((resolve, reject) => {
    let active = true;
    const detach = (cancelUnderlying: boolean) => {
      if (!active) return;
      active = false;
      signal?.removeEventListener("abort", abort);
      entry.subscribers--;
      if (cancelUnderlying && !entry.settled && entry.subscribers === 0) entry.controller.abort();
    };
    const abort = () => {
      detach(true);
      reject(abortError());
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    entry.promise.then(
      (value) => {
        if (!active) return;
        detach(false);
        resolve(value);
      },
      (error: unknown) => {
        if (!active) return;
        detach(false);
        reject(error instanceof Error ? error : new Error("Engine analysis failed"));
      },
    );
  });
}

function withDedupe(
  fen: string,
  multipv: number,
  wanted: number,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<MultiLine[] | null>,
): Promise<MultiLine[] | null> {
  const key = cacheKey(fen, multipv);
  const pending = inFlight.get(key);
  if (pending && pending.depth >= wanted) return subscribe(pending, signal);
  const controller = new AbortController();
  const entry: InFlight = {
    depth: wanted,
    controller,
    promise: Promise.resolve(null),
    subscribers: 0,
    settled: false,
  };
  entry.promise = run(controller.signal);
  inFlight.set(key, entry);
  void entry.promise.then(
    () => {
      entry.settled = true;
      if (inFlight.get(key) === entry) inFlight.delete(key);
    },
    () => {
      entry.settled = true;
      if (inFlight.get(key) === entry) inFlight.delete(key);
    },
  );
  void entry.promise.catch(() => undefined);
  return subscribe(entry, signal);
}

export function analyseMulti(
  fen: string,
  multipv: number,
  depth = DEPTH,
  movetime?: number,
  signal?: AbortSignal,
): Promise<MultiLine[] | null> {
  if (signal?.aborted) return Promise.reject(abortError());
  const wanted = movetime != null ? 0 : depth;
  const hit = cacheGet(fen, multipv, wanted);
  if (hit) return Promise.resolve(hit);
  return withDedupe(fen, multipv, wanted, signal, async (underlyingSignal) => {
    if (!ensurePool()) return null;
    const outcome = await poolSearch(fen, multipv, depth, movetime, underlyingSignal);
    if (outcome === null) return null;
    if (outcome.lines.length && !outcome.stopped) {
      const reached =
        movetime != null ? outcome.lines.reduce((m, l) => Math.max(m, l.depth), 0) : depth;
      cachePut(fen, multipv, reached, outcome.lines);
    }
    return outcome.lines;
  });
}

let liveEp: WorkerEndpoint | null = null;
let liveChain: Promise<unknown> = Promise.resolve();
function liveSerial<T>(fn: () => Promise<T>): Promise<T> {
  const run = liveChain.then(fn, fn);
  liveChain = run.catch(() => undefined);
  return run;
}

export function analyseLive(
  fen: string,
  multipv: number,
  depth = DEPTH,
): Promise<MultiLine[] | null> {
  const hit = cacheGet(fen, multipv, depth);
  if (hit) return Promise.resolve(hit);
  return withDedupe(fen, multipv, depth, undefined, () =>
    liveSerial(async () => {
      if (!liveEp || liveEp.dead) liveEp = spawnWorker();
      if (!liveEp) return null;
      const outcome = await runSearch(liveEp, fen, multipv, depth);
      if (outcome === null) {
        liveEp.terminate();
        return null;
      }
      if (outcome.lines.length && !outcome.stopped) cachePut(fen, multipv, depth, outcome.lines);
      return outcome.lines;
    }),
  );
}
