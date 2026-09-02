/**
 * Shared rig for the three modules that go over the network. `apiclient.ts` serialises every
 * request ~1s apart through module-level state, so these suites run on fake timers: real ones
 * would cost a second per call and could not assert the spacing anyway. `Date` is faked alongside
 * `setTimeout` because the limiter compares timestamps, not just timer callbacks.
 */
import { mock } from "node:test";

/**
 * Advanced an hour per use. The limiter's `lastRequest` is module state that survives between
 * tests, so a clock restarting at the same instant each time would appear to move backwards and
 * leave the next test waiting behind a timestamp from the previous one. An hour is far beyond the
 * longest wait here (the 60s rate-limit cooldown), so every test's first call is free, exactly as
 * in production where `lastRequest` starts at 0.
 */
let clockBase = 1_700_000_000_000;

export interface FakeClock {
  /** Advance the fake clock, releasing any timer due within the window. */
  tick: (ms: number) => void;
  now: () => number;
  restore: () => void;
}

export function withFakeClock(): FakeClock {
  clockBase += 3_600_000;
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: clockBase });
  return {
    tick: (ms) => {
      mock.timers.tick(ms);
    },
    now: () => Date.now(),
    restore: () => {
      mock.timers.reset();
    },
  };
}

export interface FetchStub {
  calls: { url: string; init?: RequestInit }[];
}

/** Replace global fetch, recording every call so a test can assert the URL that was built. */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): FetchStub {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return await handler(url, init);
  }) as typeof fetch;
  return { calls };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Run one request against a stubbed response, releasing the limiter. The first call under a fresh
 * clock needs no tick, but ticking anyway is harmless — the request timeout timer is only armed
 * after the limiter releases, so it cannot be tripped by this tick.
 */
export async function oneRequest<T>(
  clock: FakeClock,
  start: () => Promise<T>,
  tickMs = 1000,
): Promise<T> {
  const pending = start();
  clock.tick(tickMs);
  return await pending;
}
