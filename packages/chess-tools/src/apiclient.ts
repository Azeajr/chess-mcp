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

let lastRequest = 0;
let gate: Promise<void> = Promise.resolve();

/** Serialise requests and space them ≥ MIN_INTERVAL_MS apart. */
function rateLimit(): Promise<void> {
  gate = gate.then(async () => {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
  });
  return gate;
}

async function fetchRaw(url: string, headers?: Record<string, string>): Promise<Response | null> {
  await rateLimit();
  const ctrl = new AbortController();
  // Bounds time-to-headers only: the timer is cleared once the Response resolves, so a slow body
  // stream (e.g. a bulk Lichess PGN export) is never aborted mid-read.
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    return res.ok ? res : null;
  } finally {
    clearTimeout(timer);
  }
}

/** GET `url` as JSON, or `null` on any failure (offline-safe). */
export async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetchRaw(url, headers);
    return res ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** GET `url` as text, or `null` on any failure (offline-safe). */
export async function fetchText(url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetchRaw(url, headers);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}
