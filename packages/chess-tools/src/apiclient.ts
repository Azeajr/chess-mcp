const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 5000;
const RATE_LIMITED_COOLDOWN_MS = 60000;

let lastRequest = 0;
let gate: Promise<void> = Promise.resolve();

const cancelled = () => new DOMException("Cancelled", "AbortError");
const waitFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(cancelled());
    }
    signal?.addEventListener("abort", abort, { once: true });
  });

function rateLimit(signal?: AbortSignal): Promise<void> {
  const next = gate
    .catch(() => undefined)
    .then(async () => {
      if (signal?.aborted) throw cancelled();
      const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await waitFor(wait, signal);
      if (signal?.aborted) throw cancelled();
      lastRequest = Date.now();
    });
  gate = next.catch(() => undefined);
  return next;
}

async function fetchRaw(
  url: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response | null> {
  await rateLimit(signal);
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, TIMEOUT_MS);
  const abort = () => {
    ctrl.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (res.status === 429) lastRequest = Date.now() + RATE_LIMITED_COOLDOWN_MS - MIN_INTERVAL_MS;
    return res.ok ? res : null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function fetchJson<T>(
  url: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T | null> {
  try {
    const res = await fetchRaw(url, headers, signal);
    return res ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function fetchText(
  url: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetchRaw(url, headers, signal);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}
