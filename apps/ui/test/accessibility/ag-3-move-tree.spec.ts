import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { openApp } from "../e2e/helpers/app";
import { BRANCHING_PGN, MOVE_TREE_SCENARIO } from "./scenarios/ag-3-move-tree";
import { runTreeScenario } from "./scenarios/tree-scenario";
import { EVIDENCE_DIR, RUN_ID } from "./run-context.mjs";

test("AG-3 capture: move-tree evidence", async ({ page, browserName }) => {
  const browser = browserName as "chromium" | "firefox" | "webkit";
  await openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN });
  await page.evaluate((path) => {
    (
      window as unknown as {
        __chess: { goto(nextPath: number[]): void };
      }
    ).__chess.goto([...path]);
  }, MOVE_TREE_SCENARIO.entryPath);

  const bundle = await runTreeScenario(page, browser, MOVE_TREE_SCENARIO, {
    runId: RUN_ID,
    attemptAtCapture: process.env.A11Y_ATTEMPT_AT === "1",
  });

  expect(bundle.ariaSnapshots.length).toBeGreaterThan(0);
  expect(bundle.axe.length).toBeGreaterThan(0);

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const jobId = process.env.GITHUB_JOB ?? "local";
  const outFile = path.join(EVIDENCE_DIR, `${bundle.scenarioId}-${browser}-${jobId}.json`);
  await writeFile(outFile, JSON.stringify(bundle, null, 2));
});
