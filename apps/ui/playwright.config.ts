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
     * The exclusions were previously file-scoped regexes covering six Strategic Fit specs, which
     * dropped roughly 45 behavioural tests from two of three engines in order to protect four
     * screenshot tests — including strategic-fit-findings.spec.ts, the largest behavioural spec in
     * the repository and the home of WP-035's PD-5 journey evidence. That made "verified in
     * test:e2e:container" read as cross-browser when it was single-engine.
     *
     * `@visual` marks chromium-owned pixel baselines; `@engine-bound` marks assertions about
     * browser-native behaviour (focus order of native radios, disabled-button semantics) or
     * scan/reanalysis timing that legitimately differs per engine. Everything else now runs
     * everywhere.
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
