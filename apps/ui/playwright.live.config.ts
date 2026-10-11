import { defineConfig, devices } from "playwright/test";
import { devServer } from "@azeajr/web-harness/playwright";
import { liveModels } from "./test/live/codex-backend";

// Live chat journeys (docs/LIVE_CHAT_TESTS.md): a real model drives the guided chat through the
// ChatGPT Codex backend. Local and opt-in only — `pnpm test:e2e:live` — never part of
// `pnpm test:e2e`, the container gate or CI. One project per model in LIVE_MODEL.

const runs = Math.max(1, Math.floor(Number(process.env.LIVE_RUNS ?? 3)) || 3);

export default defineConfig<object, { liveModel: string }>({
  testDir: "./test/live",
  testMatch: /\.live\.ts$/,
  timeout: 15 * 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  repeatEach: runs,
  globalSetup: "./test/live/preflight.ts",
  outputDir: "test-results/live-chat/runs",
  reporter: [["list"], ["./test/live/summary-reporter.ts"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: liveModels().map((model) => ({
    name: model,
    use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, liveModel: model },
  })),
  webServer: devServer({
    command: "pnpm dev --host 127.0.0.1 --port 4173 --strictPort",
    port: 4173,
  }),
});
