import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    /*
     * Firefox and WebKit exclude by TAG, not by file.
     *
     * File scoping dropped ~45 behavioural tests from two of three engines in order to protect four
     * screenshot baselines (F18), including strategic-fit-findings.spec.ts, the largest behavioural
     * spec here. That made "verified via test:e2e:container" read as cross-browser when it was
     * single-engine.
     *
     * `@visual` marks chromium-owned pixel baselines — note snapshotPathTemplate has no
     * `{projectName}`, so all three engines would otherwise share one baseline file per platform.
     * `@engine-bound` marks tests whose *method* is engine-specific even though the behaviour is
     * not; each carries its reason inline at the test.
     *
     * History, because this flipped twice. Tag scoping landed in fbd458e and was reverted in
     * 7cd1566 on the theory that the extra tests per engine exhausted the CI runner. That theory
     * was wrong. Bisecting CI in 9cdd6db showed the UI job went red at c6f6998 — one commit BEFORE
     * the exclusion change, with the file-scoped ignores fully in place — from a bare
     * `overview.focus()` in strategic-fit-accessibility.spec.ts that assumed the page was
     * frontmost. Every run that tried tag scoping also carried that focus bug, so tag scoping was
     * never actually measured against a green baseline. It is fixed, and this is that measurement.
     *
     * If the UI job goes red on capacity rather than on assertions, the fix is CI capacity work
     * (worker count, per-test timeout, or sharding the UI job) — not re-widening the exclusion.
     */
    {
      name: "firefox",
      grepInvert: /@visual|@engine-bound/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      grepInvert: /@visual|@engine-bound/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
