/**
 * Separate config from ../../playwright.config.ts on purpose: the accessibility engine's specs
 * are not part of the main e2e regression suite gate (docs/accessibility/README.md — Phase 0's
 * full-suite requirement is about apps/ui/test/e2e, not this directory), and AT-tier scenarios
 * that will eventually run here need a platform-scoped project list the main config has no
 * reason to carry.
 */
import { defineConfig, devices } from "playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// AT-tier capture (A11Y_ATTEMPT_AT=1) needs a real, visible, focused window — NVDA and VoiceOver
// read what's actually rendered on screen, not a headless render target. Browser-tier-only runs
// (the default, including every Docker-container invocation) stay headless.
const headed = process.env.A11Y_ATTEMPT_AT === "1";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4173", headless: !headed },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4173",
    cwd: uiRoot,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
