/**
 * AG-2 capture stage: opens the app at a phone-sized viewport, drives the mobile tablist's arrow
 * state machine, and persists the evidence bundle. `pnpm a11y:verdict` computes the verdict after
 * every project finishes, for the same reason the other capture specs do — Playwright projects run
 * independently and there is no "after all three engines" hook inside a spec file.
 *
 * The gate forbids iPhone-specific claims, so this deliberately uses desktop engines at a phone
 * width rather than a mobile device descriptor: the claim is about the tab semantics exposed at
 * that width, not about any iOS behaviour.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { openApp } from "../e2e/helpers/app";
import { AG2_VIEWPORT, MOBILE_TABS_SCENARIO } from "./scenarios/ag-2-mobile-tabs";
import { runTabScenario } from "./scenarios/tab-scenario";
import { EVIDENCE_DIR, RUN_ID } from "./run-context.mjs";

test("AG-2 capture: mobile tablist evidence", async ({ page, browserName }) => {
  const browser = browserName as "chromium" | "firefox" | "webkit";
  await openApp(page, { width: AG2_VIEWPORT.width, height: AG2_VIEWPORT.height });

  const bundle = await runTabScenario(page, browser, MOBILE_TABS_SCENARIO, {
    runId: RUN_ID,
    attemptAtCapture: process.env.A11Y_ATTEMPT_AT === "1",
  });

  // Cheap per-browser truths that should fail loudly here rather than as a confusing gap in the
  // merged verdict later.
  expect(bundle.ariaSnapshots.length).toBeGreaterThan(0);
  expect(bundle.axe.length).toBeGreaterThan(0);
  expect(bundle.tabWalk?.length).toBe(MOBILE_TABS_SCENARIO.keyboardWalk.length);

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const jobId = process.env.GITHUB_JOB ?? "local";
  const outFile = path.join(EVIDENCE_DIR, `${bundle.scenarioId}-${browser}-${jobId}.json`);
  await writeFile(outFile, JSON.stringify(bundle, null, 2));
});
