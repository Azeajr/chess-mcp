import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { openApp } from "../e2e/helpers/app";
import { BOARD_KEYBOARD_SCENARIO } from "./scenarios/ag-4-board-keyboard";
import { runBoardScenario } from "./scenarios/board-scenario";
import { EVIDENCE_DIR, RUN_ID } from "./run-context.mjs";

test("AG-4 capture: board keyboard layer evidence", async ({ page, browserName }) => {
  const browser = browserName as "chromium" | "firefox" | "webkit";
  // "*" — a clean start position, not the default RICH_PGN fixture: the scenario's grid name is
  // the position summary ("Chessboard. White to move."), which only holds at the start position.
  await openApp(page, { width: 1280, height: 800, pgn: "*" });

  const bundle = await runBoardScenario(page, browser, BOARD_KEYBOARD_SCENARIO, {
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
