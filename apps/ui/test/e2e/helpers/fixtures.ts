import { test as base, expect } from "playwright/test";
import type { BrowserContext, ConsoleMessage, Page } from "playwright/test";

export { expect };
export type { BrowserContext, Download, Locator, Page } from "playwright/test";

// Faults that are noise everywhere in the suite. Keep this list short: a fault
// one test induces on purpose belongs in that test's `allowPageFaults` instead,
// so the same fault still fails everywhere else.
const ALLOWED_FAULTS: readonly RegExp[] = [
  // Not an app exception. Browsers report a resize handler that triggers another
  // resize through `window.onerror`, and recover on the next frame; WebKit does
  // it on the phone-viewport tests. Both spellings are in the wild.
  /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/,
];

// Nothing the app loads normally comes from outside the dev server, so anything
// that does is a live call to lichess.org, api.chess.com, or openrouter.ai —
// results that would vary by network, rate limit, and what those services
// happen to hold that day.
const isExternal = (url: URL) =>
  (url.protocol === "http:" || url.protocol === "https:") &&
  url.hostname !== "127.0.0.1" &&
  url.hostname !== "localhost";

// A JSON `null` is what `packages/chess-tools/src/apiclient.ts` hands its callers
// for any response it cannot use, so every client already treats this as "no
// data" — the same path they take against an unreachable service, minus the
// network. The permissive CORS headers matter because the stub answers a
// cross-origin request, and WebKit reports one that fails the access-control
// check as a page error rather than letting `fetch` reject into the caller's
// catch. A test that needs a real response registers its own `page.route`, which
// takes precedence.
const stubExternal = {
  status: 200,
  contentType: "application/json",
  headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "*",
  },
  body: "null",
};

// Cloud evaluation defaults on (`apps/ui/src/store/settings.ts`), and
// `apps/ui/src/store/cloud.ts` then calls lichess on a 600ms timer after every
// position change. That timer can fire while Playwright is tearing its routes
// down at the end of a test, and the request reaches the network for real —
// WebKit reports the failed access-control check as a page error, on whichever
// test happened to still be open. No spec exercises cloud evaluation, so the
// setting is off here and the timer never starts.
const disableCloudEval = () => {
  try {
    localStorage.setItem("chess.cloudeval.enabled", "false");
  } catch {
    // An init script also runs on documents with no storage access, such as
    // about:blank. The app does not run on those either.
  }
};

// Warnings that mean a subsystem degraded without throwing. `stockfish.ts`
// catches worker faults and reports them this way, so a dead engine otherwise
// reaches assertions as empty or stale analysis rather than as a failure.
const WATCHED_WARNINGS: readonly RegExp[] = [/^\[engine\]/];

interface Fault {
  readonly detail: string;
  readonly reported: string;
}

interface PageFaultGuard {
  watch(context: BrowserContext): Promise<void>;
  allow(patterns: readonly RegExp[]): void;
  faults(): readonly Fault[];
}

// The originating URL is part of what the patterns match on, so it belongs in
// the matched string and not only in the reported one.
const describe = (message: ConsoleMessage): string => {
  const { url, lineNumber } = message.location();
  return `${message.text()}${url ? ` (${url}:${lineNumber})` : ""}`;
};

// Which console output counts as a fault at all. What is then excused is
// decided in one place, when the faults are read.
const isFailure = (message: ConsoleMessage, detail: string): boolean => {
  if (message.type() === "error") return true;
  if (message.type() === "warning") return WATCHED_WARNINGS.some((watched) => watched.test(detail));
  return false;
};

export const test = base.extend<{
  pageFaultGuard: PageFaultGuard;
  /**
   * Watches a context the test built itself for faults, and cuts its pages off
   * from the network beyond the dev server. The context Playwright supplies is
   * already wired; pass any extra one from `browser.newContext()`.
   */
  watchContext: (context: BrowserContext) => Promise<void>;
  /**
   * Declares faults this test causes on purpose — an aborted route, a stubbed
   * offline engine. Scoped to the one test that calls it.
   */
  allowPageFaults: (...patterns: RegExp[]) => void;
}>({
  pageFaultGuard: [
    async ({ context }, use, testInfo) => {
      const faults: Fault[] = [];
      const allowed: RegExp[] = [];

      const attach = (page: Page) => {
        page.on("pageerror", (error) => {
          const detail = `${error.name}: ${error.message}`;
          faults.push({ detail, reported: `pageerror — ${detail}` });
        });
        page.on("console", (message) => {
          const detail = describe(message);
          if (isFailure(message, detail)) {
            faults.push({ detail, reported: `console.${message.type()} — ${detail}` });
          }
        });
      };

      const guard: PageFaultGuard = {
        async watch(target) {
          target.pages().forEach(attach);
          target.on("page", attach);
          await target.route(isExternal, (route) => route.fulfill(stubExternal));
          await target.addInitScript(disableCloudEval);
        },
        allow(patterns) {
          allowed.push(...patterns);
        },
        // Filtered on read, so a test may declare what it allows after the fault
        // it allows has already arrived.
        faults: () =>
          faults.filter(
            (fault) =>
              !ALLOWED_FAULTS.some((pattern) => pattern.test(fault.detail)) &&
              !allowed.some((pattern) => pattern.test(fault.detail)),
          ),
      };

      await guard.watch(context);
      await use(guard);

      // Only assert on an otherwise-passing test: a page error is usually the
      // cause of a failure that already carries a clearer message.
      if (testInfo.status === "passed") {
        expect(guard.faults().map((fault) => fault.reported)).toEqual([]);
      }
    },
    { auto: true },
  ],

  watchContext: async ({ pageFaultGuard }, use) => {
    await use((context) => pageFaultGuard.watch(context));
  },

  allowPageFaults: async ({ pageFaultGuard }, use) => {
    await use((...patterns) => {
      pageFaultGuard.allow(patterns);
    });
  },
});
