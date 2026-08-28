import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cpuQuota = process.env.E2E_CPU_QUOTA ?? "30%";
const memoryHigh = process.env.E2E_MEMORY_HIGH ?? "2G";
const memoryMax = process.env.E2E_MEMORY_MAX ?? "3G";
const nice = process.env.E2E_NICE ?? "15";
const runtimeMax = process.env.E2E_RUNTIME_MAX ?? "15min";
// pnpm forwards its argument separator to Node; Playwright must not receive it because it ends
// option parsing and would turn a `--list` validation into a real test run.
const rawPlaywrightArgs = process.argv.slice(2);
const playwrightArgs =
  rawPlaywrightArgs[0] === "--" ? rawPlaywrightArgs.slice(1) : rawPlaywrightArgs;

const command = [
  "exec",
  "playwright",
  "test",
  "--config",
  "apps/ui/playwright.config.ts",
  ...playwrightArgs,
  "--workers=1",
];

console.log(
  `Low-impact Playwright: one worker; CPU ${cpuQuota}; memory ${memoryHigh}/${memoryMax}; nice ${nice}; timeout ${runtimeMax}.`,
);

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
process.exitCode = result.status ?? 1;
