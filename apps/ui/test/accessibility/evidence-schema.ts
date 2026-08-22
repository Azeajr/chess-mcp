/**
 * Normalized accessibility evidence schema. Every collector in this engine produces one of these
 * shapes; the verdict engine and the (opt-in) LLM reviewer consume only these shapes — never raw
 * DOM, never a collector's internal state. That boundary is what lets a finding's provenance be
 * traced back to a specific captured observation instead of an opaque judgment call.
 */

// ---------------------------------------------------------------------------
// Scenarios: what to do, expressed as semantic actions rather than selectors, so the same
// scenario can be replayed against any collector (browser AX, AT runner) without rewriting it.
// ---------------------------------------------------------------------------

export interface SemanticTarget {
  readonly role: string;
  readonly name: string;
}

export type ScenarioAction =
  | { readonly type: "focus"; readonly target: SemanticTarget }
  | { readonly type: "activate"; readonly target?: SemanticTarget }
  | { readonly type: "key"; readonly key: string }
  | { readonly type: "type"; readonly text: string };

export interface ScenarioAssertion {
  readonly id: string;
  readonly description: string;
}

export interface Scenario {
  readonly id: string;
  readonly description: string;
  readonly startState: "app-loaded";
  readonly actions: readonly ScenarioAction[];
  readonly assertions: readonly ScenarioAssertion[];
}

// ---------------------------------------------------------------------------
// Browser accessibility-tree evidence — Playwright's per-engine computed AX tree.
// ---------------------------------------------------------------------------

export interface AriaSnapshotEvidence {
  readonly source: "playwright-aria-snapshot";
  readonly browser: "chromium" | "firefox" | "webkit";
  readonly locatorDescription: string;
  /** Playwright's YAML-ish ariaSnapshot() text — the browser engine's own computed tree. */
  readonly snapshot: string;
  readonly capturedAt: string;
}

/** Chromium-only, via CDP Accessibility.getFullAXTree. Diagnostic depth, not a correctness gate. */
export interface CdpAxNode {
  readonly nodeId: string;
  readonly role: string | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly ignored: boolean;
  readonly ignoredReasons: readonly string[];
}

export interface CdpAxTreeEvidence {
  readonly source: "cdp-full-ax-tree";
  readonly browser: "chromium";
  readonly nodeCount: number;
  readonly ignoredCount: number;
  readonly nodes: readonly CdpAxNode[];
  readonly capturedAt: string;
}

// ---------------------------------------------------------------------------
// Axe: deterministic rule findings. Never proof of full accessibility — one evidence tier.
// ---------------------------------------------------------------------------

export interface AxeViolation {
  readonly ruleId: string;
  readonly impact: "minor" | "moderate" | "serious" | "critical" | null;
  readonly description: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly wcagTags: readonly string[];
  readonly targets: readonly string[];
  readonly failureSummary: string | null;
}

export interface AxeEvidence {
  readonly source: "axe-core";
  readonly browser: "chromium" | "firefox" | "webkit";
  readonly url: string;
  readonly violations: readonly AxeViolation[];
  readonly passedRuleCount: number;
  readonly capturedAt: string;
}

// ---------------------------------------------------------------------------
// Keyboard / focus trace: one entry per key press, correlated with AX state before/after.
// ---------------------------------------------------------------------------

export interface KeyboardTraceStep {
  readonly key: string;
  readonly activeElementBefore: SemanticTarget | null;
  readonly activeElementAfter: SemanticTarget | null;
  readonly focusMovedOutsideExpectedScope: boolean;
}

export interface KeyboardTraceEvidence {
  readonly source: "keyboard-trace";
  readonly browser: "chromium" | "firefox" | "webkit";
  readonly steps: readonly KeyboardTraceStep[];
  readonly capturedAt: string;
}

// ---------------------------------------------------------------------------
// Assistive-technology evidence — real NVDA/VoiceOver output via Guidepup, when the executing
// worker's OS supports it. On a worker that cannot run the AT, the runner must report an
// InfrastructureLimitation record instead of fabricating or skipping silently.
// ---------------------------------------------------------------------------

/**
 * Which manual claim a single utterance is evidence for. Each gate asks a human NVDA session and a
 * human VoiceOver session to confirm several separate things, and one observation answers exactly
 * one of them, so each observation carries its claim rather than leaving the verdict engine to
 * infer it from the command name.
 *
 * AG-1 (dialogs): the dialog is announced with its name and as a dialog, the background is not
 * reachable by virtual cursor, and focus returns audibly on close.
 *
 * AG-3 (move tree): tree role, level, and expanded state are announced, and traversal does not read
 * the entire tree on every key. `traversal-verbosity` is the one claim scored by counting
 * utterances rather than matching a name — see verdict.ts.
 */
export type AtClaim =
  | "dialog-announcement"
  | "background-unreachable"
  | "focus-report"
  | "focus-return"
  | "tree-role"
  | "item-level"
  | "expanded-state"
  | "traversal-verbosity"
  // AG-5: one claim per live-region policy operation. The scenario id rides in the claim so the
  // verdict engine can match an observation to its expectation without a second field.
  | `live-region:${string}`;

export interface AtObservation {
  readonly source: "nvda" | "voiceover";
  readonly claim: AtClaim;
  readonly atVersion: string | null;
  readonly os: string;
  readonly browser: string;
  readonly command: string;
  readonly utterances: readonly string[];
  readonly capturedAt: string;
}

export interface InfrastructureLimitation {
  readonly runner: "nvda" | "voiceover";
  readonly reason: string;
  readonly requiredPlatform: string;
  readonly currentPlatform: string;
}

// ---------------------------------------------------------------------------
// The bundle: everything captured for one scenario run, across whatever collectors the
// executing worker actually supports. This — not a screenshot, not a URL — is the state identity.
// ---------------------------------------------------------------------------

export interface EvidenceBundle {
  readonly scenarioId: string;
  readonly runId: string;
  readonly stateFingerprint: string;
  readonly ariaSnapshots: readonly AriaSnapshotEvidence[];
  readonly cdpAxTrees: readonly CdpAxTreeEvidence[];
  readonly axe: readonly AxeEvidence[];
  readonly keyboardTraces: readonly KeyboardTraceEvidence[];
  readonly atObservations: readonly AtObservation[];
  readonly infrastructureLimitations: readonly InfrastructureLimitation[];
}

// ---------------------------------------------------------------------------
// Verdicts. "manual-at-required" is deliberately not a member of this type — see AG-1 postmortem
// in docs/accessibility/README.md for why that outcome is not acceptable as a normal result.
// ---------------------------------------------------------------------------

export type FindingStatus =
  | "confirmed-failure"
  | "confirmed-pass"
  | "likely-failure"
  | "semantic-concern"
  | "cross-platform-disagreement"
  | "automation-inconclusive"
  | "infrastructure-failure";

export interface EvidenceRef {
  readonly kind:
    | "ariaSnapshot"
    | "cdpAxTree"
    | "axe"
    | "keyboardTrace"
    | "atObservation"
    | "infrastructureLimitation";
  /** Index into the corresponding EvidenceBundle array, so a finding always points at one record. */
  readonly index: number;
}

export interface Finding {
  readonly id: string;
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly confidence: number;
  readonly status: FindingStatus;
  readonly wcag: readonly string[];
  readonly assertionId: string;
  readonly summary: string;
  readonly expected: string;
  readonly actual: string;
  readonly evidence: readonly EvidenceRef[];
  readonly reasoning: "deterministic" | "llm";
  readonly platformScope: readonly string[];
}

export interface ScenarioVerdict {
  readonly scenarioId: string;
  readonly runId: string;
  readonly findings: readonly Finding[];
  readonly overallStatus: FindingStatus;
}
