/**
 * Merge stage: reads every per-browser evidence file `pnpm a11y:capture` wrote for the most
 * recent run, merges them, computes the deterministic verdict, and writes both a JSON report
 * (machine-readable, full provenance) and a Markdown report (human-readable) next to the
 * evidence. Exits non-zero when overallStatus is a failing status, so this is the actual CI gate
 * — the Playwright specs themselves only assert capture-stage sanity, not the verdict.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DIALOG_SCENARIOS } from "./scenarios/ag-1-dialog";
import { MOVE_TREE_SCENARIO } from "./scenarios/ag-3-move-tree";
import { mergeBundles } from "./scenarios/merge";
import { computeDialogVerdict, computeTreeVerdict } from "./verdict";
import type { EvidenceBundle, ScenarioVerdict } from "./evidence-schema";
import { EVIDENCE_ROOT, LAST_RUN_ID_FILE } from "./run-context.mjs";

const SCENARIO_REGISTRY = [
  ...DIALOG_SCENARIOS.map((definition) => ({
    id: definition.id,
    computeVerdict: (bundle: EvidenceBundle) =>
      computeDialogVerdict(bundle, {
        dialogName: definition.dialogName,
        backgroundControlName: definition.backgroundControlName,
        expectedFocusReturnTargetName: definition.openerName,
      }),
  })),
  {
    id: MOVE_TREE_SCENARIO.id,
    computeVerdict: (bundle: EvidenceBundle) =>
      computeTreeVerdict(bundle, {
        treeName: MOVE_TREE_SCENARIO.treeName,
        entryMoveSan: MOVE_TREE_SCENARIO.entryMoveSan,
        branchMoveSan: MOVE_TREE_SCENARIO.branchMoveSan,
        expectedLevel: MOVE_TREE_SCENARIO.expectedLevel,
        traversalTargetSan: MOVE_TREE_SCENARIO.traversalTargetSan,
        otherMoveSans: MOVE_TREE_SCENARIO.otherMoveSans,
        floodThreshold: MOVE_TREE_SCENARIO.floodThreshold,
      }),
  },
] as const;

async function resolveRunId(): Promise<string> {
  if (process.env.A11Y_RUN_ID) return process.env.A11Y_RUN_ID;
  try {
    return (await readFile(LAST_RUN_ID_FILE, "utf8")).trim();
  } catch {
    throw new Error(
      `No A11Y_RUN_ID set and ${LAST_RUN_ID_FILE} does not exist. Run pnpm a11y:capture first.`,
    );
  }
}

function renderMarkdown(verdict: ScenarioVerdict, bundle: EvidenceBundle): string {
  const browsers = [...new Set(bundle.ariaSnapshots.map((snapshot) => snapshot.browser))];
  const lines: string[] = [
    `# Accessibility verdict — ${verdict.scenarioId}`,
    "",
    `**Run:** \`${verdict.runId}\`  `,
    `**Overall status:** \`${verdict.overallStatus}\`  `,
    `**Browsers captured:** ${browsers.join(", ") || "none"}`,
    "",
    "## Findings",
    "",
  ];
  for (const finding of verdict.findings) {
    lines.push(
      `### ${finding.id} — ${finding.status} (${finding.severity}, confidence ${finding.confidence})`,
      "",
      finding.summary,
      "",
      `- **Expected:** ${finding.expected}`,
      `- **Actual:** ${finding.actual}`,
      `- **WCAG:** ${finding.wcag.join(", ") || "n/a"}`,
      `- **Evidence:** ${finding.evidence.map((entry) => `${entry.kind}[${entry.index}]`).join(", ") || "none"}`,
      `- **Reasoning:** ${finding.reasoning}`,
      `- **Platform scope:** ${finding.platformScope.join(", ") || "all"}`,
      "",
    );
  }
  return lines.join("\n");
}

async function main() {
  const runId = await resolveRunId();
  const dir = path.join(EVIDENCE_ROOT, runId);
  const scenarioIds = new Set(SCENARIO_REGISTRY.map((scenario) => scenario.id));
  const files = (await readdir(dir)).filter(
    (name) => name.endsWith(".json") && [...scenarioIds].some((id) => name.startsWith(`${id}-`)),
  );
  if (files.length === 0) {
    throw new Error(`No evidence files found in ${dir}. Run pnpm a11y:capture first.`);
  }
  const bundles: EvidenceBundle[] = await Promise.all(
    files.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"))),
  );

  // One verdict per scenario, never one merged across them: findings are meaningful only against
  // their own expected names, interactions, and required evidence sources.
  const reports = [];
  for (const scenario of SCENARIO_REGISTRY) {
    const forScenario = bundles.filter((bundle) => bundle.scenarioId === scenario.id);
    if (forScenario.length === 0) {
      throw new Error(`No evidence bundle found for required scenario ${scenario.id}.`);
    }
    const merged = mergeBundles(forScenario);
    reports.push({
      verdict: scenario.computeVerdict(merged),
      evidence: merged,
    });
  }
  if (reports.length === 0) {
    throw new Error(`Evidence in ${dir} matched no known scenario definition.`);
  }

  await writeFile(path.join(dir, "report.json"), JSON.stringify({ reports }, null, 2));
  await writeFile(
    path.join(dir, "report.md"),
    reports.map((report) => renderMarkdown(report.verdict, report.evidence)).join("\n---\n\n"),
  );

  let failed = false;
  for (const { verdict } of reports) {
    console.log(
      `\nRun ${runId} — ${verdict.scenarioId}: overall status = ${verdict.overallStatus}`,
    );
    for (const finding of verdict.findings) {
      console.log(`  ${finding.id} [${finding.status}] ${finding.summary}`);
    }
    if (verdict.findings.some((finding) => finding.status !== "confirmed-pass")) failed = true;
  }
  console.log(`\nFull report: ${path.join(dir, "report.md")}`);
  if (failed) process.exitCode = 1;
}

await main();
