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

// Real screen-reader round trips (AppleScript/UI-Automation control, speech synthesis) are
// inherently slower than a scripted DOM check — github.com/guidepup/guidepup-playwright's own
// examples/playwright-voiceover/webkit.config.ts (a real, working reference, not a guess) uses a
// 5-minute timeout for exactly this reason. Matching it here rather than the 90s this repo
// guessed first, which was itself a guess made without that reference in hand. Raised to 8
// minutes once each AT job began covering two dialog scenarios rather than one: run 32238998739's
// VoiceOver worker timed out mid-session, and a session cut off partway leaves the next one
// reading a screen reader that never finished the last thing it was asked to do.
export default defineConfig({
  testDir: ".",
  timeout: headed ? 8 * 60_000 : 30_000,
  fullyParallel: false,
  // A native screen reader is a machine-wide singleton. Running the dialog and tree spec files in
  // separate workers would make both processes drive the same NVDA/VoiceOver session concurrently.
  workers: headed ? 1 : undefined,
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
