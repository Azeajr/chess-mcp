/**
 * Deterministic verdict engine. Every Finding this module produces cites a real EvidenceRef —
 * an index into the bundle that produced it — so "why did this fail" always traces to a captured
 * observation, never to a judgment call. This module never calls an LLM; that boundary is what
 * keeps "observed" and "inferred" distinct (see llm-review.ts, which is the only place an LLM
 * verdict can originate, and which is opt-in and clearly labeled when it does).
 */
import type {
  EvidenceBundle,
  EvidenceRef,
  Finding,
  FindingStatus,
  ScenarioVerdict,
} from "./evidence-schema";

let findingCounter = 0;
const nextFindingId = () => `A11Y-${String((findingCounter += 1)).padStart(3, "0")}`;

function ref(kind: EvidenceRef["kind"], index: number): EvidenceRef {
  return { kind, index };
}

/**
 * Cross-browser agreement is itself evidence: if Chromium, Firefox, and WebKit all expose the
 * same accessible name for a dialog, that's stronger than any single engine's snapshot. If they
 * disagree, that disagreement becomes its own finding rather than being averaged away.
 */
function checkDialogNameAndRole(bundle: EvidenceBundle, expectedName: string): Finding {
  const dialogPattern = new RegExp(`dialog\\s+"${expectedName.replace(/"/gu, '\\"')}"`, "iu");
  const perBrowser = bundle.ariaSnapshots.map((snapshot, index) => ({
    browser: snapshot.browser,
    index,
    matched: dialogPattern.test(snapshot.snapshot),
  }));
  const matchedBrowsers = perBrowser.filter((entry) => entry.matched);
  const evidence = perBrowser.map((entry) => ref("ariaSnapshot", entry.index));

  if (perBrowser.length === 0) {
    return {
      id: nextFindingId(),
      severity: "critical",
      confidence: 0,
      status: "automation-inconclusive",
      wcag: ["4.1.2"],
      assertionId: "dialog-name-and-role",
      summary: "No ariaSnapshot evidence was captured for this scenario.",
      expected: `A dialog with accessible name "${expectedName}" in every captured browser.`,
      actual: "No browser evidence collected.",
      evidence: [],
      reasoning: "deterministic",
      platformScope: [],
    };
  }
  if (matchedBrowsers.length === perBrowser.length) {
    return {
      id: nextFindingId(),
      severity: "minor",
      confidence: 1,
      status: "confirmed-pass",
      wcag: ["4.1.2"],
      assertionId: "dialog-name-and-role",
      summary: `Dialog role and accessible name "${expectedName}" confirmed by every browser engine.`,
      expected: `A dialog with accessible name "${expectedName}".`,
      actual: `Present in: ${matchedBrowsers.map((entry) => entry.browser).join(", ")}.`,
      evidence,
      reasoning: "deterministic",
      platformScope: perBrowser.map((entry) => entry.browser),
    };
  }
  if (matchedBrowsers.length === 0) {
    return {
      id: nextFindingId(),
      severity: "critical",
      confidence: 1,
      status: "confirmed-failure",
      wcag: ["4.1.2"],
      assertionId: "dialog-name-and-role",
      summary: `No browser engine exposes a dialog with accessible name "${expectedName}".`,
      expected: `A dialog with accessible name "${expectedName}".`,
      actual: `Absent in all captured engines: ${perBrowser.map((entry) => entry.browser).join(", ")}.`,
      evidence,
      reasoning: "deterministic",
      platformScope: perBrowser.map((entry) => entry.browser),
    };
  }
  return {
    id: nextFindingId(),
    severity: "serious",
    confidence: 1,
    status: "cross-platform-disagreement",
    wcag: ["4.1.2"],
    assertionId: "dialog-name-and-role",
    summary: `Browser engines disagree on whether the dialog exposes accessible name "${expectedName}".`,
    expected: `A dialog with accessible name "${expectedName}" in every captured browser.`,
    actual: `Matched: ${matchedBrowsers.map((entry) => entry.browser).join(", ") || "none"}. Did not match: ${perBrowser
      .filter((entry) => !entry.matched)
      .map((entry) => entry.browser)
      .join(", ")}.`,
    evidence,
    reasoning: "deterministic",
    platformScope: perBrowser.map((entry) => entry.browser),
  };
}

/** Background exclusion via CDP's own ignored-node bookkeeping — diagnostic, Chromium-only. */
function checkBackgroundExclusion(
  bundle: EvidenceBundle,
  backgroundControlName: string,
): Finding | null {
  if (bundle.cdpAxTrees.length === 0) return null;
  const [tree] = bundle.cdpAxTrees;
  if (!tree) return null;
  const treeIndex = 0;
  const exposedBackgroundNode = tree.nodes.find(
    (node) => !node.ignored && node.name === backgroundControlName,
  );
  if (exposedBackgroundNode) {
    return {
      id: nextFindingId(),
      severity: "critical",
      confidence: 1,
      status: "confirmed-failure",
      wcag: ["4.1.2", "2.4.3"],
      assertionId: "background-inert",
      summary: `Background control "${backgroundControlName}" remains reachable through the accessibility tree while the dialog is open.`,
      expected: "Background controls are absent from or marked ignored in the exposed AX tree.",
      actual: `Node "${exposedBackgroundNode.name}" (role ${exposedBackgroundNode.role}) is exposed and not ignored.`,
      evidence: [ref("cdpAxTree", treeIndex)],
      reasoning: "deterministic",
      platformScope: ["chromium"],
    };
  }
  return {
    id: nextFindingId(),
    severity: "minor",
    confidence: 1,
    status: "confirmed-pass",
    wcag: ["4.1.2", "2.4.3"],
    assertionId: "background-inert",
    summary: `Background control "${backgroundControlName}" is excluded from the exposed accessibility tree.`,
    expected: "Background controls are absent from or marked ignored in the exposed AX tree.",
    actual: `${tree.ignoredCount} of ${tree.nodeCount} nodes ignored; "${backgroundControlName}" not exposed.`,
    evidence: [ref("cdpAxTree", treeIndex)],
    reasoning: "deterministic",
    platformScope: ["chromium"],
  };
}

/**
 * One finding per captured trace, not just the last array entry. mergeBundles can legitimately
 * combine traces from multiple browsers and multiple CI jobs (e.g. browser-evidence's headless
 * chromium and at-nvda's headed chromium both contribute a trace) — checking only the last one
 * silently ignores every other trace's focus-return correctness depending on merge order.
 */
function checkFocusReturn(
  bundle: EvidenceBundle,
  expectedFocusTargetName: string,
): readonly Finding[] {
  return bundle.keyboardTraces.flatMap((trace, traceIndex) => {
    const lastStep = trace.steps[trace.steps.length - 1];
    if (!lastStep) return [];
    const returned = lastStep.activeElementAfter?.name === expectedFocusTargetName;
    return [
      {
        id: nextFindingId(),
        severity: returned ? ("minor" as const) : ("serious" as const),
        confidence: 1,
        status: returned ? ("confirmed-pass" as const) : ("confirmed-failure" as const),
        wcag: ["2.4.3"],
        assertionId: "focus-return",
        summary: returned
          ? `Focus returned to "${expectedFocusTargetName}" after the trace's final key press.`
          : `Focus did not return to "${expectedFocusTargetName}" after the trace's final key press.`,
        expected: `Active element is "${expectedFocusTargetName}".`,
        actual: `Active element is ${lastStep.activeElementAfter ? `"${lastStep.activeElementAfter.name}"` : "none (document body)"}.`,
        evidence: [ref("keyboardTrace", traceIndex)],
        reasoning: "deterministic" as const,
        platformScope: [trace.browser],
      },
    ];
  });
}

function checkKeyboardTrapsAndEscapes(bundle: EvidenceBundle): readonly Finding[] {
  return bundle.keyboardTraces.flatMap((trace, traceIndex) => {
    const escapedStep = trace.steps.find((step) => step.focusMovedOutsideExpectedScope);
    if (!escapedStep) return [];
    return [
      {
        id: nextFindingId(),
        severity: "serious",
        confidence: 1,
        status: "confirmed-failure" as FindingStatus,
        wcag: ["2.4.3", "2.1.2"],
        assertionId: "focus-scope-contained",
        summary: `Focus left the expected scope after pressing "${escapedStep.key}".`,
        expected: "Focus stays within the dialog/modal scope until it closes.",
        actual: `After "${escapedStep.key}", active element became ${escapedStep.activeElementAfter ? `"${escapedStep.activeElementAfter.name}"` : "none"}, outside the scope selector.`,
        evidence: [ref("keyboardTrace", traceIndex)],
        reasoning: "deterministic",
        platformScope: [trace.browser],
      },
    ];
  });
}

function axeFindings(bundle: EvidenceBundle): readonly Finding[] {
  return bundle.axe.flatMap((evidence, index) =>
    evidence.violations.map((violation) => ({
      id: nextFindingId(),
      severity:
        violation.impact === "critical"
          ? ("critical" as const)
          : violation.impact === "serious"
            ? ("serious" as const)
            : violation.impact === "moderate"
              ? ("moderate" as const)
              : ("minor" as const),
      confidence: 1,
      status: "confirmed-failure" as FindingStatus,
      wcag: violation.wcagTags,
      assertionId: `axe:${violation.ruleId}`,
      summary: violation.help,
      expected: violation.description,
      actual: violation.failureSummary ?? `Targets: ${violation.targets.join(", ")}`,
      evidence: [ref("axe", index)],
      reasoning: "deterministic" as const,
      platformScope: [evidence.browser],
    })),
  );
}

/** Every non-supporting worker's InfrastructureLimitation becomes its own explicit finding. */
function infrastructureFindings(bundle: EvidenceBundle): readonly Finding[] {
  return bundle.infrastructureLimitations.map((limitation) => ({
    id: nextFindingId(),
    severity: "minor",
    confidence: 1,
    status: "automation-inconclusive" as FindingStatus,
    wcag: [],
    assertionId: `at-runner:${limitation.runner}`,
    summary: `${limitation.runner} evidence not collected: ${limitation.reason}`,
    expected: `Real ${limitation.runner} output for this scenario.`,
    actual: `Worker platform is ${limitation.currentPlatform}; ${limitation.runner} requires ${limitation.requiredPlatform}.`,
    evidence: [],
    reasoning: "deterministic" as const,
    platformScope: [limitation.requiredPlatform],
  }));
}

function overallStatus(findings: readonly Finding[]): FindingStatus {
  const priority: FindingStatus[] = [
    "infrastructure-failure",
    "confirmed-failure",
    "cross-platform-disagreement",
    "likely-failure",
    "semantic-concern",
    "automation-inconclusive",
    "confirmed-pass",
  ];
  for (const status of priority) {
    if (findings.some((finding) => finding.status === status)) return status;
  }
  return "automation-inconclusive";
}

export interface DialogScenarioExpectation {
  readonly dialogName: string;
  readonly backgroundControlName: string;
  readonly expectedFocusReturnTargetName: string;
}

/**
 * The AG-1 deterministic verdict: dialog name/role, background exclusion, focus return, keyboard
 * containment, and axe — every claim traced to an EvidenceRef. Does not decide the AT-tier claims
 * (screen readers "convey" the dialog); those become their own findings, confirmed-pass when a
 * real AtObservation exists, automation-inconclusive when only an InfrastructureLimitation does.
 */
export function computeDialogVerdict(
  bundle: EvidenceBundle,
  expectation: DialogScenarioExpectation,
): ScenarioVerdict {
  findingCounter = 0;
  const findings: Finding[] = [
    checkDialogNameAndRole(bundle, expectation.dialogName),
    ...[checkBackgroundExclusion(bundle, expectation.backgroundControlName)].filter(
      (finding): finding is Finding => finding !== null,
    ),
    ...checkFocusReturn(bundle, expectation.expectedFocusReturnTargetName),
    ...checkKeyboardTrapsAndEscapes(bundle),
    ...axeFindings(bundle),
    ...infrastructureFindings(bundle),
  ];
  return {
    scenarioId: bundle.scenarioId,
    runId: bundle.runId,
    findings,
    overallStatus: overallStatus(findings),
  };
}
