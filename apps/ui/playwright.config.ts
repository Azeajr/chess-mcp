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
     * tests, and that 132 of 135 of them pass cross-browser when run on a developer machine.
     *
     * Tag-scoping them (`grepInvert: /@visual|@engine-bound/`) was attempted in fbd458e and
     * reverted here: the extra ~45 tests per engine push the CI runner past its capacity, and the
     * run fails on resource contention rather than on behaviour. Three tests timed out or lost
     * page focus on CI (chromium core-keyboard announcement, webkit stage-tab focus, webkit
     * cohort-adjustment click) while the identical commit passed 673/673 locally.
     *
     * Reopening this needs CI capacity work — worker count, per-test timeout, or sharding the UI
     * job — not another round of per-test tagging. Until then the coarse exclusion stands, and
     * evidence citing `test:e2e:container` for these six specs is chromium-only.
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
