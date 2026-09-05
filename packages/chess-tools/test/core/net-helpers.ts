import { afterEach, mock } from "node:test";

let fetchBeforeTest: typeof fetch | undefined;
afterEach(() => {
  if (fetchBeforeTest !== undefined) globalThis.fetch = fetchBeforeTest;
  fetchBeforeTest = undefined;
  mock.timers.reset();
});

let clockBase = 1_700_000_000_000;

export interface FakeClock {
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
  restore: () => void;
}

export function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): FetchStub {
  const calls: { url: string; init?: RequestInit }[] = [];
  fetchBeforeTest ??= globalThis.fetch;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return await handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function oneRequest<T>(
  clock: FakeClock,
  start: () => Promise<T>,
  tickMs = 1000,
): Promise<T> {
  const pending = start();
  clock.tick(tickMs);
  return await pending;
}
