/**
 * Rate-limited, offline-safe HTTP — the TS port of the Python server's apiclient.py. Every
 * failure (network down, timeout, non-200, unparseable body) degrades to `null`, never throws,
 * so a consumer treats it exactly like a cache miss. A single global limiter enforces the
 * ~1 req/s Lichess asks of unauthenticated clients.
 *
 * Note: the Python client sends a User-Agent; browsers forbid setting it, so it's omitted here.
 * In the browser this means Lichess sees an anonymous client (tighter limits) — acceptable for
 * occasional cloud-eval / tablebase lookups. Same code runs under Node's global fetch.
 */
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 5000;
// Lichess asks clients that receive a 429 to wait a full minute before the next request
// (https://lichess.org/api#section/Introduction/Rate-limiting).
const RATE_LIMITED_COOLDOWN_MS = 60000;

let lastRequest = 0;
let gate: Promise<void> = Promise.resolve();

const cancelled = () => new DOMException("Cancelled", "AbortError");
const waitFor = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(cancelled()); return; }
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener("abort", abort); resolve(); }
  function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(cancelled()); }
  signal?.addEventListener("abort", abort, { once: true });
});

/** Serialise requests and space them ≥ MIN_INTERVAL_MS apart. */
function rateLimit(signal?: AbortSignal): Promise<void> {
  const next = gate.catch(() => undefined).then(async () => {
    if (signal?.aborted) throw cancelled();
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await waitFor(wait, signal);
    if (signal?.aborted) throw cancelled();
    lastRequest = Date.now();
  });
  gate = next.catch(() => undefined);
  return next;
}

async function fetchRaw(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<Response | null> {
  await rateLimit(signal);
  const ctrl = new AbortController();
  // Bounds time-to-headers only: the timer is cleared once the Response resolves, so a slow body
  // stream (e.g. a bulk Lichess PGN export) is never aborted mid-read.
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const abort = () => ctrl.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    // A 429 still degrades to null for the caller, but the global limiter holds ALL requests for
    // the cooldown — one throttled consumer must not let the next call re-offend a second later.
    if (res.status === 429) lastRequest = Date.now() + RATE_LIMITED_COOLDOWN_MS - MIN_INTERVAL_MS;
    return res.ok ? res : null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** GET `url` as JSON, or `null` on any failure (offline-safe). */
export async function fetchJson<T>(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetchRaw(url, headers, signal);
    return res ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** GET `url` as text, or `null` on any failure (offline-safe). */
export async function fetchText(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetchRaw(url, headers, signal);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}
