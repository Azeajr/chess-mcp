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
     * These exclusions are file-scoped, which is coarser than it should be: F18 established that
     * ~45 behavioural tests are dropped from two of three engines to protect four screenshot
     * baselines, and that 132 of 135 of them pass cross-browser when run on a developer machine.
     *
     * Tag-scoping them (`grepInvert: /@visual|@engine-bound/`) was attempted in fbd458e and
     * reverted in 7cd1566, on the theory that the extra tests per engine exhausted the CI runner.
     * That theory was wrong, and this comment used to state it as fact. Bisecting the CI history
     * in 9cdd6db showed the UI job went red at c6f6998 — one commit BEFORE the exclusion change,
     * with these file-scoped ignores fully in place. The cause was a bare `overview.focus()` in
     * strategic-fit-accessibility.spec.ts that assumed the page was frontmost, and it is fixed.
     *
     * So the coarse exclusion stands only because tag-scoping has not been re-measured since that
     * fix landed — not because it is known to fail. Every run that tried it also carried the focus
     * bug, so its viability is genuinely unmeasured. Until someone retests it, evidence citing
     * `test:e2e:container` for these specs is chromium-only.
     *
     * The `@visual` and `@engine-bound` tags survive from the fbd458e work. `@visual` is still
     * consumed by `test:e2e:host`; `@engine-bound` is consumed by nothing here and is documentation
     * only — it becomes load-bearing again if tag-scoping is restored.
     */
    {
      name: "firefox",
      testIgnore:
        /strategic-fit-(findings|map|visualization-hardening|large-report|profile-setup|sidecar)\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore:
        /strategic-fit-(findings|map|visualization-hardening|large-report|lifecycle|sidecar)\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
