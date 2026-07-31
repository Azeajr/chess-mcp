import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildRepertoireGraph,
  contractsForHost,
  createDefaultStrategicFitDocumentMetadata,
  createStrategicFitTrainingPerformanceData,
  jsonSchemaForTool,
  normalizeStrategicFitDocumentMetadata,
  toolContract,
  validateToolArguments,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitDocumentMetadata,
  type StrategicFitPlanCardInput,
  type StrategicFitTrainingPerformanceData,
} from "@chess-mcp/chess-tools";
import { streamChat } from "../src/llm/openrouter.ts";
import { executeBrowserCommand } from "../src/application/browser-commands/client.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import {
  createStrategicFitResolutionState,
  type StrategicFitResolutionStateBoundary,
} from "../src/store/strategic-fit-resolutions.ts";
import {
  createStrategicFitTrainingPerformanceState,
  createStrategicFitTrainingState,
  strategicFitPlanEvidenceForRecord,
  type StrategicFitTrainingArtifact,
  type StrategicFitTrainingBoundary,
} from "../src/store/strategic-fit-training.ts";
import {
  createStrategicFitPlanSynthesisState,
  type StrategicFitPlanBasisResult,
  type StrategicFitPlanProposalResult,
} from "../src/store/strategic-fit-plan-synthesis.ts";
import type { StrategicFitCompletedResult } from "../src/store/strategic-fit.ts";

const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *";

/**
 * Plan synthesis is exercised over the real Task 6.3 training writer and the real Task 4.4/6.2
 * resolution state, so "nothing is persisted" and "acceptance goes through the existing writer"
 * are asserted against the same code paths the product uses.
 */
function planFixture(options: { missingFinding?: boolean } = {}) {
  const tree = GameTree.fromPgn(PGN);
  const graph = buildRepertoireGraph(tree, "white");
  const route = graph.routes[0]!;
  const opening = graph.positions.find((position) => position.position_id === route.position_ids[0])!;
  const second = graph.positions.find((position) => position.position_id === route.position_ids[2])!;
  const causalDecision = graph.decisions.find((decision) => decision.decision_id === route.decision_ids[2])!;
  let revision = 4;
  let conceptSignalPresent = true;
  const finding = {
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    finding_id: "finding:plan",
    semantic_finding_id: "semantic:finding:plan",
    repertoire_revision: "browser:4",
    references: {
      position_ids: [opening.position_id, second.position_id],
      decision_ids: [causalDecision.decision_id],
      route_ids: [route.route_id],
      source_san_paths: route.source_san_paths,
    },
    evidence: {
      cohort_id: "cohort:plan",
      causality: {
        likely_causal_decision_ids: [causalDecision.decision_id],
        timeline: [{
          event_id: "event:causal",
          kind: "player-decision",
          ply: 2,
          position_id: second.position_id,
          decision_id: causalDecision.decision_id,
          san: causalDecision.san,
          explanation: "The player decision creates the exception.",
        }],
      },
    },
    resolution_state: "unresolved",
  } as unknown as StrategicFinding;
  const buildReport = (): StrategicFitAnalysisResult => ({
    schema_version: "1.0.0",
    analysis_version: "2.0.0",
    report_id: "report:plan",
    repertoire_revision: "browser:4",
    trajectories: [{
      analysis_version: "2.0.0",
      trajectory_id: `trajectory:${route.route_id}`,
      route_id: route.route_id,
      state: "complete",
      snapshots: [{
        analysis_version: "2.0.0",
        snapshot_id: "snapshot:opening",
        route_id: route.route_id,
        position_id: opening.position_id,
        fen: opening.fen,
        checkpoint: {
          analysis_version: "2.0.0",
          checkpoint_id: "checkpoint:opening",
          kind: "opening-exit",
          ply: 0,
          reason: "Start with the first legal repertoire decision.",
          comparability: "comparable",
        },
        signals: conceptSignalPresent
          ? [{
            analysis_version: "2.0.0",
            signal_id: "signal:concept",
            family: "learning-concepts",
            feature_id: "concept:center-control",
            kind: "derived-concept",
            value: true,
            confidence: 1,
            persistence: "stable",
            provenance: [],
          }]
          : [],
        classifier_confidence: 1,
        provenance: [],
      }, {
        analysis_version: "2.0.0",
        snapshot_id: "snapshot:second",
        route_id: route.route_id,
        position_id: second.position_id,
        fen: second.fen,
        checkpoint: {
          analysis_version: "2.0.0",
          checkpoint_id: "checkpoint:second",
          kind: "configured-ply",
          ply: 2,
          reason: "Practice the causal player decision.",
          comparability: "comparable",
        },
        signals: [],
        classifier_confidence: 1,
        provenance: [],
      }],
      missing_checkpoints: [],
      evidence_coverage: 1,
      stable_signal_ids: ["signal:concept"],
      transient_signal_ids: [],
      provenance: [],
    }],
    cohorts: [{
      cohort_id: "cohort:plan",
      modes: [{ supporting_route_ids: [route.route_id], concept_ids: ["concept:causal-plan"] }],
    }],
    findings: [finding],
  } as unknown as StrategicFitAnalysisResult);
  const completed = (): StrategicFitCompletedResult => ({
    request_id: "request:plan",
    report_id: "report:plan",
    request_snapshot: {
      document_id: "document:plan",
      repertoire_revision: revision,
      repertoire_pgn: tree.toPgn(),
      repertoire_color: "white",
      profile_identity: "profile:balanced",
      settings_identity: "settings:plan",
    },
    result: buildReport(),
    completed_at: "2026-07-31T14:00:00.000Z",
  });
  let metadata: StrategicFitDocumentMetadata = createDefaultStrategicFitDocumentMetadata();
  let tick = 0;
  const resolutionBoundary: StrategicFitResolutionStateBoundary = {
    currentMetadata: () => metadata,
    currentGraph: () => graph,
    currentProfile: () => metadata.profile,
    currentRepertoireRevision: () => "browser:4",
    replaceMetadata: (input) => {
      const normalized = normalizeStrategicFitDocumentMetadata(input);
      metadata = normalized.metadata;
      return normalized;
    },
    invalidateReports: () => {},
    now: () => `2026-07-31T14:00:${String(tick++).padStart(2, "0")}.000Z`,
  };
  const resolutions = createStrategicFitResolutionState(resolutionBoundary);
  const artifacts: Array<{ content: string; name: string }> = [];
  let performance: StrategicFitTrainingPerformanceData =
    createStrategicFitTrainingPerformanceData("document:plan");
  const performanceState = createStrategicFitTrainingPerformanceState({
    currentDocumentId: () => "document:plan",
    currentData: () => performance,
    currentGraph: () => graph,
    replaceData: (next) => { performance = next; },
    createArtifact: (_format, content, name) => {
      artifacts.push({ content, name });
      return { artifact_id: `artifact:${artifacts.length}` };
    },
    now: () => "2026-07-31T14:00:00.000Z",
  });
  const trainingBoundary: StrategicFitTrainingBoundary = {
    currentReport: completed,
    currentFinding: (reportId, findingId) =>
      !options.missingFinding && reportId === "report:plan" && findingId === finding.finding_id
        ? finding
        : null,
    currentMetadata: () => metadata,
    currentGraph: () => graph,
    resolutionAvailability: () => ({ available: true, code: null, message: null, finding }),
    upsertTrainingReference: (input) => resolutions.upsertTrainingReference(input),
    removeTrainingReference: (id) => resolutions.removeTrainingReference(id),
    transitionResolution: (input) => {
      const result = resolutions.upsertResolution({
        resolution_id: `strategic-fit-resolution:${input.semantic_finding_id}`,
        finding_id: input.finding_id,
        semantic_finding_id: input.semantic_finding_id,
        state: input.state,
        references: finding.references,
        note: input.note,
        linked_training_ids: input.linked_training_ids,
      });
      return {
        state: result.state === "unchanged" ? "unchanged" : "updated",
        code: null,
        message: "Training resolution saved.",
        resolution: "train-as-exception",
      };
    },
    upsertPerformanceTargets: (record) => { performanceState.register(record); },
    createArtifact: (_format, content, name) => {
      artifacts.push({ content, name });
      return { artifact_id: `artifact:${artifacts.length}` };
    },
    now: resolutionBoundary.now,
  };
  const training = createStrategicFitTrainingState(trainingBoundary);
  const state = createStrategicFitPlanSynthesisState({
    currentDocumentId: () => "document:plan",
    currentRevision: () => revision,
    planEvidence: (subject) => {
      const record = training.buildCurrent(subject);
      return record === null ? null : strategicFitPlanEvidenceForRecord(record, subject.report_id);
    },
    saveTraining: (subject, card) => training.create({ ...subject, plan_card: card }),
    now: () => "2026-07-31T14:05:00.000Z",
  });
  return {
    tree,
    state,
    subject: {
      report_id: "report:plan",
      finding_id: finding.finding_id,
      semantic_finding_id: finding.semantic_finding_id,
    },
    metadata: () => metadata,
    performance: () => performance,
    artifacts,
    setRevision: (next: number) => { revision = next; },
    dropConceptSignal: () => { conceptSignalPresent = false; },
  };
}

const groundedPlan = (): StrategicFitPlanCardInput => ({
  title: "Hold the Nf3 setup",
  sections: [
    {
      kind: "strategic-plan",
      text: "Answer with Nf3 and finish development before touching the center.",
      concept_ids: ["concept:center-control"],
    },
    {
      kind: "danger-sign",
      text: "If the queenside expands first, stop and recount the defenders.",
      checkpoint_ids: ["checkpoint:second"],
    },
  ],
});

test("the canonical plan contract is browser-only, action-shaped, and saves nothing by itself", () => {
  const contract = toolContract("propose_strategic_fit_plan");
  assert.deepEqual([...contract.hosts], ["browser"]);
  assert.equal(contract.result.kind, "action");
  assert.match(contract.result.semantics ?? "", /Proposing changes nothing/);
  assert.equal(
    contractsForHost("mcp").some((entry) => entry.name === "propose_strategic_fit_plan"),
    false,
    "MCP keeps no training state, so it must not advertise a plan card",
  );
  assert.equal(jsonSchemaForTool("propose_strategic_fit_plan", "mcp"), null);
  const browser = jsonSchemaForTool("propose_strategic_fit_plan", "browser")!;
  assert.deepEqual(
    Object.keys(browser.properties as Record<string, unknown>).sort(),
    ["finding_id", "plan", "report_id", "semantic_finding_id"],
  );
  assert.deepEqual(
    [...(browser.required as string[])].sort(),
    ["finding_id", "report_id", "semantic_finding_id"],
    "the evidence request needs identity only; the plan itself is the second step",
  );
});

test("canonical validation rejects a plan whose sections cite nothing", () => {
  const identity = {
    report_id: "report:plan",
    finding_id: "finding:plan",
    semantic_finding_id: "semantic:finding:plan",
  };
  const check = (args: Record<string, unknown>) =>
    validateToolArguments("propose_strategic_fit_plan", args, "browser");
  assert.equal(check(identity).ok, true, "an evidence request carries no plan");
  assert.equal(check({ ...identity, report_id: " " }).reason, "report_id must not be blank");
  assert.equal(check({ ...identity, plan: { title: "Plan", sections: [] } }).ok, false);
  assert.equal(
    check({ ...identity, plan: { title: "Plan", sections: [{ kind: "strategic-plan", text: "Develop." }] } }).reason,
    "plan.sections[0] must cite at least one concept, checkpoint, or drill from the finding's evidence",
  );
  assert.equal(
    check({ ...identity, plan: { title: "Plan", sections: [{ kind: "model-position", text: "Play it.", concept_ids: ["concept:center-control"] }] } }).reason,
    "plan.sections[0] is a model position and must cite a drill from the finding's evidence",
  );
  assert.equal(
    check({ ...identity, plan: { title: "Plan", sections: [{ kind: "brilliancy", text: "x", concept_ids: ["c"] }] } }).ok,
    false,
    "an invented section kind never reaches the store",
  );
});

test("the evidence basis discloses only deterministic material and says what it withheld", () => {
  const subject = planFixture();
  const basis = subject.state.basis(subject.subject) as StrategicFitPlanBasisResult;
  assert.equal(basis.kind, "strategic_fit_plan_basis");
  assert.equal(basis.persisted, false);
  assert.deepEqual(basis.concept_ids, ["concept:causal-plan", "concept:center-control"]);
  assert.deepEqual(
    basis.checkpoints.map((checkpoint) => checkpoint.checkpoint_id),
    ["checkpoint:opening", "checkpoint:second"],
  );
  assert.ok(basis.drills.length >= 2);
  assert.equal(basis.causal_move_san, "Nf3");
  assert.equal(basis.moves.includes("Nf3"), true);
  assert.equal(basis.moves.includes("Qh5"), false, "the vocabulary is the validated paths, not chess");
  assert.equal(basis.omitted_concept_count, 0);
  assert.equal(basis.omitted_drill_count, 0);
  assert.deepEqual(subject.metadata().training_references, [], "asking for evidence saves nothing");
  assert.deepEqual(subject.metadata().resolutions, []);
  assert.deepEqual(subject.artifacts, []);
});

test("a grounded plan stages without touching training metadata, resolutions, or the repertoire", () => {
  const subject = planFixture();
  const before = subject.tree.toPgn();
  const proposal = subject.state.propose(subject.subject, groundedPlan());
  assert.equal(proposal.kind, "strategic_fit_plan_card");
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.persisted, false);
  assert.equal(proposal.scope, "training-metadata-only");
  assert.equal(proposal.title, "Hold the Nf3 setup");
  assert.deepEqual(proposal.sections.map((section) => section.kind), ["strategic-plan", "danger-sign"]);
  assert.deepEqual(proposal.sections[0]!.cited_moves, ["Nf3"], "the mentioned move resolved to evidence");
  assert.equal(JSON.stringify(proposal).includes("evidence_identity"), false, "identities stay host-side");
  assert.equal(subject.state.plan(proposal.plan_id)?.status, "pending");
  assert.deepEqual(subject.metadata().training_references, []);
  assert.deepEqual(subject.metadata().resolutions, []);
  assert.deepEqual(subject.performance().targets, []);
  assert.deepEqual(subject.artifacts, []);
  assert.equal(subject.tree.toPgn(), before, "a plan proposal never edits repertoire lines");
});

test("an unsupported model game, line, or concept cannot be staged at all", () => {
  const subject = planFixture();
  const code = (plan: StrategicFitPlanCardInput) => {
    try {
      subject.state.propose(subject.subject, plan);
      return "accepted";
    } catch (error) {
      return (error as { code?: string }).code ?? "unknown";
    }
  };
  assert.equal(
    code({
      title: "Play it like the classics",
      sections: [{
        kind: "model-position",
        text: "Follow the famous 1972 handling of this structure.",
        drill_ids: [],
      }],
    }),
    "strategic_fit_plan_unsupported_model_game",
  );
  assert.equal(
    code({
      title: "Break with f5",
      sections: [{
        kind: "pawn-break",
        text: "Prepare f5 once the center is closed.",
        concept_ids: ["concept:center-control"],
      }],
    }),
    "strategic_fit_plan_unsupported_move",
    "a pawn break the repertoire never plays is the model inventing chess",
  );
  assert.equal(
    code({
      title: "Plan",
      sections: [{ kind: "strategic-plan", text: "Play well.", concept_ids: ["concept:invented"] }],
    }),
    "strategic_fit_plan_unsupported_concept",
  );
  assert.equal(subject.state.plans().length, 0, "nothing invalid was ever staged");
  assert.deepEqual(subject.metadata().resolutions, []);
});

test("accepting saves through the training writer; rejecting leaves no trace", () => {
  const subject = planFixture();
  const rejected = subject.state.propose(subject.subject, groundedPlan());
  assert.equal(subject.state.reject(rejected.plan_id).ok, true);
  assert.equal(subject.state.plan(rejected.plan_id)?.status, "rejected");
  assert.deepEqual(subject.metadata().training_references, [], "a rejected plan persists nothing");
  assert.deepEqual(subject.metadata().resolutions, []);
  assert.deepEqual(subject.artifacts, []);
  assert.equal(subject.state.accept(rejected.plan_id).ok, false, "a rejected plan cannot be replayed");

  const treeBefore = subject.tree.toPgn();
  const accepted = subject.state.propose(subject.subject, groundedPlan());
  const result = subject.state.accept(accepted.plan_id);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.training_id?.startsWith("strategic-fit-training:"), true);
  assert.equal(subject.state.plan(accepted.plan_id)?.status, "accepted");
  assert.equal(subject.state.accept(accepted.plan_id).ok, false, "an accepted plan cannot be replayed");

  const reference = subject.metadata().training_references[0]!;
  assert.equal(reference.training_id, result.ok === true ? result.training_id : "");
  const resolution = subject.metadata().resolutions[0]!;
  assert.equal(resolution.state, "train-as-exception");
  assert.match(resolution.note ?? "", /Hold the Nf3 setup/, "the confirmed plan reaches document metadata");
  assert.match(resolution.note ?? "", /Danger sign:/);
  assert.match(resolution.note ?? "", /checkpoint:second/, "durable text keeps the evidence behind each section");
  assert.ok(subject.performance().targets.length >= 2, "acceptance registers the existing drill targets");
  assert.equal(subject.tree.toPgn(), treeBefore, "acceptance never edits repertoire lines");
});

test("the saved drill artifact carries the plan card with its evidence links", () => {
  const subject = planFixture();
  const proposal = subject.state.propose(subject.subject, groundedPlan());
  const result = subject.state.accept(proposal.plan_id);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.artifact_id, `artifact:${subject.artifacts.length}`);
  const artifact = JSON.parse(subject.artifacts.at(-1)!.content) as StrategicFitTrainingArtifact;
  assert.equal(artifact.artifact_version, "1.2.0");
  assert.equal(artifact.plan_card?.title, "Hold the Nf3 setup");
  assert.deepEqual(artifact.plan_card?.sections[1]?.checkpoint_ids, ["checkpoint:second"]);
  assert.match(artifact.plan_card?.evidence_identity ?? "", /^strategic-fit-plan-evidence:/);
  assert.equal(artifact.plan_card?.training_id, artifact.training_id, "the card names the item it belongs to");
  assert.equal(
    artifact.drills.every((drill) => drill.expected_san.length > 0),
    true,
    "the deterministic drills are unchanged by plan synthesis",
  );
});

test("a plan fails closed once the revision, the evidence, or the finding moves", () => {
  for (const [label, disturb] of [
    ["revision", (subject: ReturnType<typeof planFixture>) => subject.setRevision(5)],
    ["evidence", (subject: ReturnType<typeof planFixture>) => subject.dropConceptSignal()],
  ] as const) {
    const subject = planFixture();
    const proposal = subject.state.propose(subject.subject, groundedPlan());
    disturb(subject);
    const result = subject.state.accept(proposal.plan_id);
    assert.equal(result.ok, false, `${label} change must invalidate the plan`);
    assert.equal(result.ok === false && result.error, "strategic_fit_plan_stale");
    assert.equal(subject.state.plan(proposal.plan_id)?.status, "stale");
    assert.deepEqual(subject.metadata().training_references, [], `${label}: no write from the stale accept`);
    assert.deepEqual(subject.metadata().resolutions, []);
    assert.deepEqual(subject.artifacts, []);
  }

  const missing = planFixture({ missingFinding: true });
  assert.throws(
    () => missing.state.basis(missing.subject),
    (error: { code?: string }) => error.code === "strategic_fit_plan_evidence_unavailable",
    "a finding the current report does not contain has no evidence to plan from",
  );
});

test("a fake model's plan reaches the browser command, stages only, and never edits the repertoire", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://test" } }, configurable: true });
  const planArguments = JSON.stringify({
    report_id: "report:plan",
    finding_id: "finding:plan",
    semantic_finding_id: "semantic:finding:plan",
    plan: {
      title: "Hold the setup",
      sections: [{
        kind: "strategic-plan",
        text: "Finish development first.",
        concept_ids: ["concept:center-control"],
      }],
    },
  });
  globalThis.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          choices: [{
            delta: { tool_calls: [{ index: 0, id: "p1", function: { name: "propose_strategic_fit_plan", arguments: planArguments } }] },
            finish_reason: "tool_calls",
          }],
        })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200 },
  );
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  });

  const stream = await streamChat({ apiKey: "x", model: "fake", messages: [], tools: [], onText() {} });
  assert.equal(stream.toolCalls.length, 1);
  const call = stream.toolCalls[0]!;
  assert.equal(call.function.name, "propose_strategic_fit_plan");

  const staged: unknown[] = [];
  const pgnBefore = defaultBrowserCommandDependencies.currentPgn();
  const revisionBefore = defaultBrowserCommandDependencies.currentRevision();
  const result = await executeBrowserCommand(
    call.function.name,
    JSON.parse(call.function.arguments) as Record<string, unknown>,
    {},
    {
      ...defaultBrowserCommandDependencies,
      proposeStrategicFitPlan: (input) => {
        staged.push(input);
        return { kind: "strategic_fit_plan_card", plan_id: "strategic-fit-plan:1", status: "pending" };
      },
      stageEdit: () => assert.fail("a plan card must never stage a repertoire edit"),
      proposeLine: () => assert.fail("a plan card must never propose a line"),
    },
  ) as StrategicFitPlanProposalResult;
  assert.equal(result.kind, "strategic_fit_plan_card");
  assert.equal(staged.length, 1);
  assert.deepEqual(staged[0], JSON.parse(planArguments));
  assert.equal(defaultBrowserCommandDependencies.currentPgn(), pgnBefore, "the repertoire PGN is unchanged");
  assert.equal(defaultBrowserCommandDependencies.currentRevision(), revisionBefore);

  const unsupported = await executeBrowserCommand(
    "propose_strategic_fit_plan",
    {
      report_id: "report:plan",
      finding_id: "finding:plan",
      semantic_finding_id: "semantic:finding:plan",
      plan: { title: "Model game", sections: [{ kind: "model-position", text: "Play it." }] },
    },
    {},
    defaultBrowserCommandDependencies,
  ) as { error: string };
  assert.equal(unsupported.error, "invalid_arguments", "an unsupported model position never reaches the store");

  const withoutReport = await executeBrowserCommand(
    "propose_strategic_fit_plan",
    { report_id: "report:gone", finding_id: "finding:gone", semantic_finding_id: "semantic:gone" },
    {},
    defaultBrowserCommandDependencies,
  ) as { error: string };
  assert.equal(
    withoutReport.error,
    "strategic_fit_plan_evidence_unavailable",
    "an unknown finding is reported as unavailable evidence rather than answered",
  );
});
