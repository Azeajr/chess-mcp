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

const AT_SOURCES = ["nvda", "voiceover"] as const;
const AT_CLAIMS = ["dialog-announcement", "focus-report", "focus-return"] as const;

/**
 * What each AG-1 claim requires a real utterance to contain, and why. Every expectation resolves
 * from the bundle or the scenario expectation rather than being hardcoded per screen reader —
 * NVDA and VoiceOver phrase everything differently, so the check is "does the utterance contain
 * the right real name", never "does it match this exact sentence".
 */
function atClaimExpectation(
  claim: (typeof AT_CLAIMS)[number],
  bundle: EvidenceBundle,
  observation: EvidenceBundle["atObservations"][number],
  expectation: DialogScenarioExpectation,
): { readonly needles: readonly string[]; readonly description: string } | null {
  if (claim === "dialog-announcement") {
    // AG-1's wording: "announced with its name and as a dialog" — both halves, hence two needles.
    return {
      needles: [expectation.dialogName, "dialog"],
      description: `names "${expectation.dialogName}" and identifies it as a dialog`,
    };
  }
  if (claim === "focus-return") {
    return {
      needles: [expectation.expectedFocusReturnTargetName],
      description: `names the opener "${expectation.expectedFocusReturnTargetName}" after the dialog closes`,
    };
  }
  // focus-report: the target is not hardcoded — it comes from the same bundle's keyboard trace,
  // recorded on the same page, so this stays a comparison between two real observations.
  const focusTarget = bundle.keyboardTraces.find((trace) => trace.browser === observation.browser)
    ?.steps[0]?.activeElementBefore?.name;
  if (focusTarget === undefined || focusTarget === "") return null;
  return {
    needles: [focusTarget],
    description: `names the control that actually had focus, "${focusTarget}"`,
  };
}

/**
 * The AT tier: one finding per screen reader per AG-1 claim. AG-1 asks a human NVDA session and a
 * human VoiceOver session to confirm three separate things, so three separate utterances are
 * scored rather than one standing in for all of them.
 *
 * A source with no observation anywhere in the merged bundle falls back to the
 * InfrastructureLimitation the non-supporting workers filed for it, once, rather than repeating
 * the same gap per claim. A limitation is only inconclusive when nothing covered that source:
 * once the Windows worker has captured NVDA, the Linux worker's "nvda requires win32" note is a
 * description of the split, not a gap.
 */
function atFindings(
  bundle: EvidenceBundle,
  expectation: DialogScenarioExpectation,
): readonly Finding[] {
  return AT_SOURCES.flatMap((source) => {
    if (!bundle.atObservations.some((observation) => observation.source === source)) {
      const limitation = bundle.infrastructureLimitations.find((entry) => entry.runner === source);
      return [
        {
          id: nextFindingId(),
          severity: "minor" as const,
          confidence: 1,
          status: "automation-inconclusive" as FindingStatus,
          wcag: [],
          assertionId: `at-runner:${source}`,
          summary: limitation
            ? `${source} evidence not collected: ${limitation.reason}`
            : `${source} evidence not collected, and no worker reported why.`,
          expected: `Real ${source} output for this scenario.`,
          actual: limitation
            ? `Worker platform is ${limitation.currentPlatform}; ${source} requires ${limitation.requiredPlatform}.`
            : `No ${source} observation and no InfrastructureLimitation in the merged bundle.`,
          evidence: [],
          reasoning: "deterministic" as const,
          platformScope: limitation ? [limitation.requiredPlatform] : [],
        },
      ];
    }

    return AT_CLAIMS.flatMap((claim): Finding[] => {
      const observationIndex = bundle.atObservations.findIndex(
        (entry) => entry.source === source && entry.claim === claim,
      );
      const observation = bundle.atObservations[observationIndex];
      if (observation === undefined) {
        return [
          {
            id: nextFindingId(),
            severity: "minor",
            confidence: 1,
            status: "automation-inconclusive",
            wcag: ["4.1.2"],
            assertionId: `at-runner:${source}:${claim}`,
            summary: `${source} produced evidence for this scenario but nothing for the ${claim} claim.`,
            expected: `A real ${source} utterance covering ${claim}.`,
            actual: `The ${source} session recorded no ${claim} observation.`,
            evidence: [],
            reasoning: "deterministic",
            platformScope: [],
          },
        ];
      }

      const utterances = observation.utterances.join(" | ") || "(nothing)";
      const evidence = [ref("atObservation", observationIndex)];
      const claimExpectation = atClaimExpectation(claim, bundle, observation, expectation);
      if (claimExpectation === null) {
        return [
          {
            id: nextFindingId(),
            severity: "minor",
            confidence: 1,
            status: "automation-inconclusive",
            wcag: ["4.1.2"],
            assertionId: `at-runner:${source}:${claim}`,
            summary: `${source} produced an utterance, but no keyboard trace names what had focus when it was captured.`,
            expected: `A ${observation.browser} keyboard trace whose first step records the focused control.`,
            actual: `${source} said "${utterances}"; no comparable trace for ${observation.browser}.`,
            evidence,
            reasoning: "deterministic",
            platformScope: [observation.os],
          },
        ];
      }

      const missing = claimExpectation.needles.filter(
        (needle) =>
          !observation.utterances.some((utterance) =>
            utterance.toLowerCase().includes(needle.toLowerCase()),
          ),
      );
      const satisfied = missing.length === 0;
      return [
        {
          id: nextFindingId(),
          severity: satisfied ? "minor" : "serious",
          confidence: 1,
          status: satisfied ? "confirmed-pass" : "confirmed-failure",
          wcag: ["4.1.2", ...(claim === "focus-return" ? ["2.4.3"] : [])],
          assertionId: `at-runner:${source}:${claim}`,
          summary: satisfied
            ? `${source} ${claimExpectation.description}.`
            : `${source} never ${claimExpectation.description} — missing: ${missing.join(", ")}.`,
          expected: `A real ${source} utterance that ${claimExpectation.description}.`,
          actual: `${source} on ${observation.os}/${observation.browser} (${observation.command}) said "${utterances}".`,
          evidence,
          reasoning: "deterministic",
          platformScope: [observation.os],
        },
      ];
    });
  });
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
    ...atFindings(bundle, expectation),
  ];
  return {
    scenarioId: bundle.scenarioId,
    runId: bundle.runId,
    findings,
    overallStatus: overallStatus(findings),
  };
}
