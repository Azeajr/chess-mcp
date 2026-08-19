#!/usr/bin/env node
/**
 * The reasoning layer, not the source of truth. Reads a computed report.json (deterministic
 * findings + raw evidence, already produced by compute-verdict.ts) and asks an LLM to correlate,
 * judge semantic/UX quality, and flag cross-source disagreement the deterministic engine can't
 * see (e.g. an accessible name that is technically present but confusing). It never re-decides a
 * deterministic finding's status, and every semantic finding it returns must cite a real
 * EvidenceRef into the same bundle it was given — citations that don't resolve are rejected
 * before this script's output is trusted, not treated as evidence themselves.
 *
 * Gated behind A11Y_LLM_REVIEW=1 and never invoked by CI or by `pnpm a11y:test` — token cost is
 * real and this step is opt-in on purpose. Run manually: A11Y_LLM_REVIEW=1 pnpm a11y:llm-review
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EVIDENCE_ROOT, LAST_RUN_ID_FILE } from "./run-context.mjs";

if (process.env.A11Y_LLM_REVIEW !== "1") {
  console.error(
    "LLM review is opt-in. Set A11Y_LLM_REVIEW=1 to run it — it spends real tokens on every invocation.",
  );
  process.exit(1);
}

const runId = process.env.A11Y_RUN_ID ?? (await readFile(LAST_RUN_ID_FILE, "utf8")).trim();
const dir = path.join(EVIDENCE_ROOT, runId);
const reportPath = path.join(dir, "report.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));

const evidenceCounts = Object.fromEntries(
  Object.entries(report.evidence).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.length : 0,
  ]),
);

const systemPrompt = `You are the LLM reasoning layer of an automated accessibility evidence pipeline. You receive ONE evidence bundle and its already-computed deterministic findings. Your job:

- Correlate findings across sources; note disagreement the deterministic engine did not catch.
- Judge accessible-name and instruction quality (confusing but technically present names).
- Connect findings to WCAG success criteria where clearly applicable.
- Prioritize severity and suggest concrete fixes.

Hard rules:
- Every claim about observed behavior MUST cite an evidence reference in the exact shape
  {"kind": "<ariaSnapshot|cdpAxTree|axe|keyboardTrace|atObservation|infrastructureLimitation>", "index": <n>}
  where <n> is a valid index into evidence.<kind + "s"> in the bundle you were given (pluralized,
  e.g. kind "axe" -> evidence.axe). A citation that does not resolve to a real array element will
  be rejected and the finding discarded before anyone sees it.
- Do NOT invent observations. Do NOT restate or override a deterministic finding's status.
- If you cannot support a claim with a real citation, classify it as "semantic-concern" with
  reasoning "llm" and say plainly what evidence would be needed to raise its confidence, rather
  than asserting it as fact.
- Output ONLY a JSON array of finding objects matching this TypeScript shape (no prose, no
  markdown fences):
  { summary: string, expected: string, actual: string, wcag: string[], severity: "critical"|"serious"|"moderate"|"minor",
    confidence: number, status: "semantic-concern"|"likely-failure"|"cross-platform-disagreement",
    evidence: {kind: string, index: number}[], reasoning: "llm" }
  Return [] if you find nothing beyond the deterministic findings.`;

const userPrompt = JSON.stringify({ evidenceCounts, report }, null, 2);

console.log(
  `Running LLM review over run ${runId} (evidenceCounts: ${JSON.stringify(evidenceCounts)})...`,
);

const result = spawnSync("claude", ["-p", systemPrompt, "--permission-mode", "bypassPermissions"], {
  input: userPrompt,
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 16,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(result.stderr);
  throw new Error(`claude -p exited ${result.status}`);
}

let candidateFindings;
try {
  const fencedMatch = result.stdout.match(/```(?:json)?\s*([\s\S]*?)```/u);
  candidateFindings = JSON.parse(fencedMatch ? fencedMatch[1] : result.stdout);
} catch (error) {
  throw new Error(`LLM output was not parseable JSON: ${error.message}\n---\n${result.stdout}`);
}
if (!Array.isArray(candidateFindings)) {
  throw new Error(`LLM output was not a JSON array.\n---\n${result.stdout}`);
}

function evidenceArrayFor(kind) {
  const key = `${kind}s`;
  return Array.isArray(report.evidence[key]) ? report.evidence[key] : null;
}

const accepted = [];
const rejected = [];
let findingSeq = report.verdict.findings.length;
for (const candidate of candidateFindings) {
  const refs = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  const badRef = refs.find((ref) => {
    const array = evidenceArrayFor(ref?.kind);
    return !array || typeof ref.index !== "number" || ref.index < 0 || ref.index >= array.length;
  });
  if (badRef) {
    rejected.push({
      candidate,
      reason: `unresolvable evidence citation: ${JSON.stringify(badRef)}`,
    });
    continue;
  }
  if (refs.length === 0 && candidate.status !== "semantic-concern") {
    rejected.push({ candidate, reason: "no evidence citation and status is not semantic-concern" });
    continue;
  }
  findingSeq += 1;
  accepted.push({
    id: `A11Y-LLM-${String(findingSeq).padStart(3, "0")}`,
    ...candidate,
  });
}

if (rejected.length > 0) {
  console.warn(`Rejected ${rejected.length} LLM finding(s) with unverifiable citations:`);
  for (const entry of rejected) console.warn(`  - ${entry.reason}`);
}
console.log(`Accepted ${accepted.length} LLM finding(s), each with a verified evidence citation.`);
for (const finding of accepted)
  console.log(`  ${finding.id} [${finding.status}] ${finding.summary}`);

await writeFile(
  path.join(dir, "llm-review.json"),
  JSON.stringify({ runId, accepted, rejected }, null, 2),
);
console.log(`\nWritten: ${path.join(dir, "llm-review.json")}`);
