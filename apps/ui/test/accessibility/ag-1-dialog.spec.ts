/**
 * Capture stage only: opens the Strategic Fit dialog, runs every collector this project's browser
 * supports, and persists the resulting evidence bundle to disk. `pnpm a11y:verdict` (run after all
 * projects finish) merges the per-browser files and computes the deterministic verdict — kept as a
 * separate step because Playwright projects execute independently and there is no single point
 * "after chromium, firefox, and webkit have all run" inside a spec file itself.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { openApp } from "../e2e/helpers/app";
import { DIALOG_SCENARIOS } from "./scenarios/ag-1-dialog";
import { runDialogScenario } from "./scenarios/dialog-scenario";
import { EVIDENCE_DIR, RUN_ID } from "./run-context.mjs";

for (const scenario of DIALOG_SCENARIOS) {
  test(`AG-1 capture: ${scenario.dialogName} dialog evidence`, async ({ page, browserName }) => {
    const browser = browserName as "chromium" | "firefox" | "webkit";
    await openApp(page);

    const bundle = await runDialogScenario(page, browser, scenario, {
      runId: RUN_ID,
      attemptAtCapture: process.env.A11Y_ATTEMPT_AT === "1",
    });

    // Sanity assertions at the capture stage — these are cheap, per-browser truths (a dialog
    // opened, axe ran) that should fail loudly here rather than surface only as a confusing gap
    // in the merged verdict later.
    expect(bundle.ariaSnapshots.length).toBeGreaterThan(0);
    expect(bundle.axe.length).toBeGreaterThan(0);

    await mkdir(EVIDENCE_DIR, { recursive: true });
    // GITHUB_JOB (a standard Actions env var — the running job's id, e.g. "at-nvda") keeps this
    // filename unique across CI jobs that legitimately capture the same scenario+browser pair with
    // different meaning — browser-evidence's headless chromium versus at-nvda's headed
    // A11Y_ATTEMPT_AT chromium. Without it, .github/workflows/accessibility.yml run 32206066681
    // downloaded both jobs' artifacts into one merge directory via merge-multiple: true and one
    // silently overwrote the other, producing confirmed-failure findings that were actually just
    // Windows-headed evidence masquerading as the Linux-headless capture. Local runs have no job
    // id and no collision risk (one job, browser name alone already disambiguates).
    const jobId = process.env.GITHUB_JOB ?? "local";
    const outFile = path.join(EVIDENCE_DIR, `${bundle.scenarioId}-${browser}-${jobId}.json`);
    await writeFile(outFile, JSON.stringify(bundle, null, 2));
  });
}
