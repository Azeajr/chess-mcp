import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { openApp } from "../e2e/helpers/app";
import { runLiveRegionScenario } from "./scenarios/ag-5-live-region";
import { EVIDENCE_DIR, RUN_ID } from "./run-context.mjs";

test("AG-5 capture: live-region evidence", async ({ page, browserName }) => {
  const browser = browserName as "chromium" | "firefox" | "webkit";
  await openApp(page, { width: 1280, height: 800 });

  // Capture-stage sanity: the regions exist at the app root before any collector runs.
  await expect(page.locator("[data-app-live-region='polite']")).toBeAttached();
  await expect(page.locator("[data-app-live-region='assertive']")).toBeAttached();

  const bundle = await runLiveRegionScenario(
    page,
    browser,
    RUN_ID,
    process.env.A11Y_ATTEMPT_AT === "1",
  );

  expect(bundle.ariaSnapshots.length).toBeGreaterThan(0);

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const jobId = process.env.GITHUB_JOB ?? "local";
  const outFile = path.join(EVIDENCE_DIR, `${bundle.scenarioId}-${browser}-${jobId}.json`);
  await writeFile(outFile, JSON.stringify(bundle, null, 2));
});
