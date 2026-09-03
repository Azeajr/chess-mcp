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

/*
 * `@visual` screenshot baselines are generated inside the Playwright image by
 * playwright-container.mjs (`test:e2e:update-snapshots`), so they encode that image's font set.
 * This runner is the *host* path — the same specs compared against whatever fonts the developer's
 * machine happens to have, which is a comparison they cannot pass. Measured on one Arch host:
 * three baselines off by 2,416 / 29,119 / 44,461 pixels on unmodified `main`, one of them
 * 1215x914 against 1215x895 — a 19px height change, i.e. re-wrapped text, i.e. font substitution.
 *
 * Excluding them here rather than in each script keeps one source of truth for the rule "the host
 * runner cannot judge container-owned baselines". CI never reaches this file; it runs
 * `test:e2e:container`, where the baselines are valid and still enforced.
 *
 * `E2E_VISUAL=1` opts back in, for eyeballing a diff locally. A caller's own `--grep-invert` wins
 * outright, because Playwright takes the last one and silently dropping theirs would be worse.
 */
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
process.exitCode = result.status ?? 1;
