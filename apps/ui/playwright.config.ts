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
     * Exclusions are tag-scoped, plus one measured file-scoped exception on WebKit.
     *
     * `@visual` marks chromium-owned pixel baselines. Excluding them from the other two engines is
     * required, not just tidy: snapshotPathTemplate has no `{projectName}`, so all three engines
     * would otherwise share one baseline file per platform. `@engine-bound` marks tests whose
     * *method* is engine-specific even though the behaviour is not; each carries its reason inline.
     *
     * Why this is not file-scoped any more. F18 found that file scoping dropped ~45 behavioural
     * tests from two of three engines to protect four screenshot baselines, including
     * strategic-fit-findings.spec.ts, the largest behavioural spec here — which made "verified via
     * test:e2e:container" read as cross-browser when it was single-engine. Tag scoping landed in
     * fbd458e, was reverted in 7cd1566 on a CI-capacity theory, and that theory was wrong:
     * bisecting in 9cdd6db showed the UI job went red at c6f6998, one commit BEFORE the exclusion
     * change, from a bare `overview.focus()` that assumed the page was frontmost. Every run that
     * tried tag scoping also carried that focus bug, so it had never been measured cleanly.
     *
     * Measured cleanly here, twice, on CI runs 33458348402 and 33459724530:
     *
     *   - Firefox ran the full tag-scoped set — 223 tests, 0 failures, both runs. It is unrestricted.
     *   - WebKit failed only inside strategic-fit-findings.spec.ts, so only that file is excluded
     *     from WebKit. Every other spec the old regex excluded (map, visualization-hardening,
     *     large-report, lifecycle, sidecar) passed on WebKit in both runs and now runs there.
     *
     * The two WebKit failures, for whoever revisits this:
     *
     *   - :1170 cohort adjustments — deterministic. Failed both runs at an identical 30.3 s, versus
     *     5.6 s on chromium and 8.2 s on firefox. The click on "Confirm and analyze again" never
     *     returns: the test budget expires during the action, which is main-thread starvation
     *     during reanalysis, not a behaviour difference. Whether a larger budget passes is
     *     UNMEASURED — do not tag it `@engine-bound` on the strength of a 30 s result alone.
     *   - :1997 staged change review — flaked once in two runs, `page.goto` never reaching `load`.
     *     Runner capacity, not the app.
     *
     * Serving a production build via `vite preview` to cut server overhead is NOT an option here,
     * and the reason is structural: `window.__chess` is behind `import.meta.env.DEV` in index.tsx
     * and is absent from production bundles, `assertTestOnly()` in store/test-seam.ts throws when
     * `DEV !== true`, the COOP/COEP plugin in vite.config.ts only implements `configureServer` so
     * SharedArrayBuffer (threaded Stockfish) would be unavailable, and a built bundle registers the
     * service worker that dev deliberately disables. Real remaining levers for WebKit are worker
     * count, a larger per-test budget for that one test, or sharding the UI job.
     */
    {
      name: "firefox",
      grepInvert: /@visual|@engine-bound/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: /strategic-fit-findings\.spec\.ts/,
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
