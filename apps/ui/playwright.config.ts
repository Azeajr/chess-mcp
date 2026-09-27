import { defineConfig, devices } from "playwright/test";
import { devServer } from "@azeajr/web-harness/playwright";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
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
  // The dev server, because the suite drives the `window.__chess` development
  // accessors; the production build is proven separately (test/pwa-lifecycle.mjs
  // and `web-harness smoke`). Never reused: a server left on 4173 from another
  // worktree or an older checkout is refused instead of silently tested.
  webServer: devServer({
    command: "pnpm dev --host 127.0.0.1 --port 4173 --strictPort",
    port: 4173,
  }),
});
