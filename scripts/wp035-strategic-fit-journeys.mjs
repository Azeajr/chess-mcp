#!/usr/bin/env node
/**
 * WP-035 — generates the Review/Redesign journey report.
 *
 * Runs the two named WP-035 journeys, has them write their trace to a temporary path, validates
 * every metric against the package's fixed thresholds, and only then places the report in `docs/`.
 * A failed run, a missing journey, or any metric outside its threshold leaves the committed report
 * untouched and exits non-zero — the report can never describe a run that did not pass.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const destination = path.join(
  root,
  "docs/ui-ux-remediation/reports/WP-035-strategic-fit-journeys.json",
);

/**
 * The thresholds PD-5's no-split decision actually rests on. Each is a fixed number rather than a
 * judgement: a review that never enters redesign, a redesign entered exactly once and only on
 * purpose, an indicator that always agreed with the application's own stage, and no control
 * rendered twice at any point in either journey.
 */
const THRESHOLDS = {
  review: {
    decisionCount: 1,
    explicitRedesignEntryCount: 0,
    implicitRedesignEntryCount: 0,
    stageStateMismatchCount: 0,
    duplicateControlCount: 0,
    maximumHorizontalOverflowPixels: 0,
  },
  redesign: {
    confirmableAcceptanceCount: 1,
    explicitRedesignEntryCount: 1,
    implicitRedesignEntryCount: 0,
    stageStateMismatchCount: 0,
    duplicateControlCount: 0,
    maximumHorizontalOverflowPixels: 0,
  },
};

const workspace = mkdtempSync(path.join(tmpdir(), "wp035-"));
const reportPath = path.join(workspace, "report.json");

try {
  const run = spawnSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "apps/ui/playwright.config.ts",
      "apps/ui/test/e2e/strategic-fit-findings.spec.ts",
      "--project=chromium",
      "--grep",
      "WP-035",
      "--reporter=list",
    ],
    { cwd: root, stdio: "inherit", env: { ...process.env, WP035_REPORT_PATH: reportPath } },
  );

  if (run.status !== 0) {
    console.error("WP-035: journeys failed; the committed report was not modified.");
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const failures = [];

  if (report.decision !== "no-split") failures.push(`decision is "${report.decision}"`);
  for (const [id, thresholds] of Object.entries(THRESHOLDS)) {
    const journey = report.journeys?.find((entry) => entry.id === id);
    if (!journey) {
      failures.push(`journey "${id}" is missing`);
      continue;
    }
    if (!Array.isArray(journey.transitions) || journey.transitions.length === 0) {
      failures.push(`journey "${id}" recorded no transitions`);
      continue;
    }
    for (const transition of journey.transitions) {
      if (transition.stageStateEqual !== true) {
        failures.push(
          `journey "${id}" transition ${transition.sequence} broke stage-state equality`,
        );
      }
    }
    for (const [metric, expected] of Object.entries(thresholds)) {
      const actual = journey.metrics?.[metric];
      if (actual !== expected) {
        failures.push(
          `journey "${id}" ${metric}: expected ${expected}, measured ${String(actual)}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error("WP-035: thresholds not met; the committed report was not modified.");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`WP-035: every threshold met; report written to ${path.relative(root, destination)}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
