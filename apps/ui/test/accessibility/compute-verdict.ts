/**
 * Merge stage: reads every per-browser evidence file `pnpm a11y:capture` wrote for the most
 * recent run, merges them, computes the deterministic verdict, and writes both a JSON report
 * (machine-readable, full provenance) and a Markdown report (human-readable) next to the
 * evidence. Exits non-zero when overallStatus is a failing status, so this is the actual CI gate
 * — the Playwright specs themselves only assert capture-stage sanity, not the verdict.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AG1_BACKGROUND_CONTROL_NAME,
  AG1_DIALOG_NAME,
  AG1_OPENER_NAME,
  AG1_SCENARIO_ID,
  mergeBundles,
} from "./scenarios/ag-1-dialog";
import { computeDialogVerdict } from "./verdict";
import type { EvidenceBundle, ScenarioVerdict } from "./evidence-schema";
import { EVIDENCE_ROOT, LAST_RUN_ID_FILE } from "./run-context.mjs";

const FAILING_STATUSES = new Set([
  "confirmed-failure",
  "cross-platform-disagreement",
  "infrastructure-failure",
]);

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
  const files = (await readdir(dir)).filter(
    (name) => name.startsWith(`${AG1_SCENARIO_ID}-`) && name.endsWith(".json"),
  );
  if (files.length === 0) {
    throw new Error(`No evidence files found in ${dir}. Run pnpm a11y:capture first.`);
  }
  const bundles: EvidenceBundle[] = await Promise.all(
    files.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"))),
  );
  const merged = mergeBundles(bundles);
  const verdict = computeDialogVerdict(merged, {
    dialogName: AG1_DIALOG_NAME,
    backgroundControlName: AG1_BACKGROUND_CONTROL_NAME,
    expectedFocusReturnTargetName: AG1_OPENER_NAME,
  });

  await writeFile(
    path.join(dir, "report.json"),
    JSON.stringify({ verdict, evidence: merged }, null, 2),
  );
  await writeFile(path.join(dir, "report.md"), renderMarkdown(verdict, merged));

  console.log(`\nRun ${runId}: overall status = ${verdict.overallStatus}`);
  for (const finding of verdict.findings) {
    console.log(`  ${finding.id} [${finding.status}] ${finding.summary}`);
  }
  console.log(`\nFull report: ${path.join(dir, "report.md")}`);

  if (verdict.findings.some((finding) => FAILING_STATUSES.has(finding.status))) {
    process.exitCode = 1;
  }
}

await main();
