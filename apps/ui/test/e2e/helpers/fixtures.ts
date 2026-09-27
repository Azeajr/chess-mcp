import { test as base, expect } from "playwright/test";
import { createHarnessTest } from "@azeajr/web-harness/playwright";
import harness from "../../../../../harness.config.mjs";

export { expect };
export type { BrowserContext, Download, Locator, Page } from "playwright/test";

// The shared fault guard (web-harness), with the fault policy the agent
// controller uses (`pnpm ux:review`) read from the same harness.config.mjs:
//
// - page errors and console errors fail an otherwise-passing test, and so do
//   `[engine]` warnings — stockfish.ts catches worker faults and reports them
//   that way, so a dead engine would otherwise reach assertions as empty or
//   stale analysis rather than as a failure;
// - failed requests and same-origin HTTP errors fail it too;
// - anything leaving the dev server — lichess.org, api.chess.com,
//   openrouter.ai — is stubbed with a JSON `null`, which every client in
//   packages/chess-tools/src/apiclient.ts already treats as "no data", and is
//   recorded as a fault: results must not vary with the network. A test that
//   needs a real response registers its own `page.route`, which takes
//   precedence and is not recorded;
// - cloud evaluation is switched off before first boot (it calls lichess on a
//   600ms timer that could outlive a test's routes);
// - `ResizeObserver loop` noise is excused everywhere, since browsers report it
//   through `window.onerror` and recover on the next frame.
//
// Fixtures kept from the suite's own guard: `pageFaultGuard` (auto),
// `watchContext` for a context a test built itself, `allowPageFaults` for faults
// one test causes on purpose — any kind, that test only — plus
// `expectPageFault`, which also fails the test if the fault never happens.
export const test = createHarnessTest(base, harness);
