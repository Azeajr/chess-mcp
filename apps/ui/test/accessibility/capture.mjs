#!/usr/bin/env node
/**
 * Computes one A11Y_RUN_ID and runs the capture spec under it, so every browser project's worker
 * process (each a separate Node process under Playwright) writes evidence into the same run
 * directory. Plain Node child_process rather than shell string interpolation because this needs
 * to run identically on the ubuntu/windows/macos CI matrix — see .github/workflows/accessibility.yml.
 *
 * Set A11Y_CONTAINER=1 to route the same capture through this repo's existing
 * scripts/playwright-container.mjs (the pinned Docker image already used for the main e2e suite)
 * instead of the host's local Playwright install — the only way to get real Firefox/WebKit
 * evidence on a machine without their system libraries installed, with zero GitHub Actions
 * involvement. A11Y_* env vars are forwarded into the container by that script.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAST_RUN_ID_FILE } from "./run-context.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const uiRoot = path.resolve(here, "../..");
const runId = process.env.A11Y_RUN_ID ?? new Date().toISOString().replace(/[:.]/gu, "-");
const passthroughArgs = process.argv.slice(2);
const selectedSpec = process.env.A11Y_SPEC;
const containerSpec = selectedSpec
  ? path.posix.join("apps/ui/test/accessibility", path.basename(selectedSpec))
  : undefined;
// Playwright treats file arguments as patterns. A Windows absolute path contains backslashes,
// which the matcher interprets as escapes; use a package-relative POSIX path on every host.
const localSpec = selectedSpec
  ? path.posix.join("test/accessibility", path.basename(selectedSpec))
  : undefined;

const [command, args] =
  process.env.A11Y_CONTAINER === "1"
    ? [
        "node",
        [
          path.join(repoRoot, "scripts/playwright-container.mjs"),
          "--",
          "--config",
          "apps/ui/test/accessibility/playwright.config.ts",
          ...(containerSpec ? [containerSpec] : []),
          ...passthroughArgs,
        ],
      ]
    : [
        "pnpm",
        [
          "exec",
          "playwright",
          "test",
          "--config",
          path.join(here, "playwright.config.ts"),
          ...(localSpec ? [localSpec] : []),
          ...passthroughArgs,
        ],
      ];

const result = spawnSync(command, args, {
  stdio: "inherit",
  cwd: process.env.A11Y_CONTAINER === "1" ? repoRoot : uiRoot,
  env: { ...process.env, A11Y_RUN_ID: runId },
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
console.log(`\nA11Y_RUN_ID=${runId}`);
// pnpm a11y:verdict runs as a separate process afterward; it has no other way to learn which
// run this was without the caller manually propagating A11Y_RUN_ID.
mkdirSync(path.dirname(LAST_RUN_ID_FILE), { recursive: true });
writeFileSync(LAST_RUN_ID_FILE, runId);
process.exitCode = result.status ?? 1;
