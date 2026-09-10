import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cpuQuota = process.env.E2E_CPU_QUOTA ?? "30%";
const memoryHigh = process.env.E2E_MEMORY_HIGH ?? "2G";
const memoryMax = process.env.E2E_MEMORY_MAX ?? "3G";
const nice = process.env.E2E_NICE ?? "15";
const runtimeMax = process.env.E2E_RUNTIME_MAX ?? "15min";
const rawPlaywrightArgs = process.argv.slice(2);
const playwrightArgs =
  rawPlaywrightArgs[0] === "--" ? rawPlaywrightArgs.slice(1) : rawPlaywrightArgs;

const callerFiltersInverse = playwrightArgs.some((arg) => arg.startsWith("--grep-invert"));
const skipVisual = process.env.E2E_VISUAL !== "1" && !callerFiltersInverse;

const command = [
  "exec",
  "playwright",
  "test",
  "--config",
  "apps/ui/playwright.config.ts",
  ...playwrightArgs,
  ...(skipVisual ? ["--grep-invert=@visual"] : []),
  "--workers=1",
];

console.log(
  `Low-impact Playwright: one worker; CPU ${cpuQuota}; memory ${memoryHigh}/${memoryMax}; nice ${nice}; timeout ${runtimeMax}.`,
);
if (skipVisual) {
  console.log(
    "Skipping @visual: those baselines belong to the Playwright container image. Run them with `pnpm test:e2e:container`, or set E2E_VISUAL=1 to compare against this host's fonts.",
  );
}

if (process.env.E2E_DRY_RUN === "1") {
  console.log(`Command: pnpm ${command.join(" ")}`);
  process.exit(0);
}

const result = spawnSync(
  "systemd-run",
  [
    "--user",
    "--wait",
    "--pipe",
    "--collect",
    "--unit=chess-mcp-playwright-low-impact",
    `--working-directory=${root}`,
    `--property=CPUQuota=${cpuQuota}`,
    `--property=MemoryHigh=${memoryHigh}`,
    `--property=MemoryMax=${memoryMax}`,
    `--property=Nice=${nice}`,
    `--property=RuntimeMaxSec=${runtimeMax}`,
    "--",
    "pnpm",
    ...command,
  ],
  { stdio: "inherit" },
);

if (result.error) {
  throw new Error(
    `Low-impact Playwright requires systemd-run to enforce its resource limits: ${result.error.message}`,
  );
}

// A failing run under a tight CPU quota is usually starvation, not a real defect: the
// analysis worker misses each test's own in-test timeout. Observed on the strategic-fit
// specs, where one test took 30s (timing out) at 30% and 4.3s at 200%.
if (result.status !== 0 && !process.env.E2E_CPU_QUOTA) {
  console.log(
    `\nTests failed under the default CPU quota of ${cpuQuota}. If the failures are timeouts ` +
      `waiting on work the app performs (analysis completing, a click landing, page.evaluate ` +
      `returning), re-run with a larger quota before believing them:\n` +
      `  E2E_CPU_QUOTA=200% pnpm test:e2e <spec>`,
  );
}

// The notice above the run says @visual is being skipped; this one says it again once the
// result is in, because that is when a green run is easy to read as "everything passed".
// Two @visual baseline drifts reached CI this way, each after a local run reported all
// green — the drift was never in the run, it was in the tests the run never executed.
if (result.status === 0 && skipVisual) {
  console.log(
    "\nPassed, but @visual was excluded from this run. Visual baselines are only " +
      "verified by `pnpm test:e2e:container` (or E2E_VISUAL=1 against this host's fonts). " +
      "Anything that shifts layout — copy length, wrapping, spacing — can move a baseline " +
      "without failing a single test here.",
  );
}

process.exitCode = result.status ?? 1;
