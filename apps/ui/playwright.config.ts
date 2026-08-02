import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      // Chromium owns visual baselines; large reports are engine-bound, profile radio focus follows
      // browser-native tab behavior, and stale sidecar confirmation intentionally targets a disabled
      // native button. The remaining non-snapshot suite runs on Firefox.
      testIgnore:
        /strategic-fit-(findings|map|visualization-hardening|large-report|profile-setup|sidecar)\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      // Chromium owns visual baselines; large-report scans and the lifecycle reanalysis timing
      // contract are engine-bound, while stale sidecar confirmation targets a disabled native
      // button. The remaining non-snapshot suite runs on WebKit.
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
