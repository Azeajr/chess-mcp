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

/** GET `url` as JSON, or `null` on any failure (offline-safe). */
export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    await rateLimit();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null; // 404 (e.g. cloud-eval miss), 429, 5xx → treated as a miss
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
