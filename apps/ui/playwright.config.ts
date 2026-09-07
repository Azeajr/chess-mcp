import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [
    { name: "chromium", grepInvert: /@mobile-webkit/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      grepInvert: /@visual|@engine-bound|@mobile-webkit/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: /strategic-fit-findings\.spec\.ts/,
      grepInvert: /@visual|@engine-bound|@mobile-webkit/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-webkit",
      grep: /@mobile-webkit/,
      use: { ...devices["iPhone 13 Mini"] },
    },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
