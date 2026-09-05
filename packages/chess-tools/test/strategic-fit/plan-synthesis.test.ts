import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_PLAN_LIMITS,
  STRATEGIC_FIT_PLAN_SECTION_KINDS,
  assertStrategicFitPlanCardSupported,
  renderStrategicFitPlanCardText,
  resolveStrategicFitPlanCard,
  strategicFitPlanErrorResult,
  strategicFitPlanEvidenceIdentity,
  strategicFitPlanMoveMentions,
  strategicFitPlanSectionLabel,
  type StrategicFitPlanCardInput,
  type StrategicFitPlanEvidence,
} from "../../src/index.ts";

const EVIDENCE: StrategicFitPlanEvidence = {
  report_id: "report:plan",
  finding_id: "finding:plan",
  semantic_finding_id: "semantic:finding:plan",
  repertoire_revision: "browser:4",
  training_id: "strategic-fit-training:abc",
  concept_ids: ["setup-family.castling.repertoire.kingside", "concept:center-control"],
  omitted_concept_count: 1,
  checkpoints: [
    {
      checkpoint_id: "checkpoint:opening",
      kind: "opening-exit",
      ply: 0,
      comparability: "comparable",
    },
    {
      checkpoint_id: "checkpoint:second",
      kind: "configured-ply",
      ply: 2,
      comparability: "comparable",
    },
  ],
  omitted_checkpoint_count: 0,
  drills: [
    {
      drill_id: "strategic-fit-drill:one",
      expected_san: "Nf3",
      source_san_path: ["e4", "e5"],
      source: "causal-move",
      checkpoint_id: null,
    },
    {
      drill_id: "strategic-fit-drill:two",
      expected_san: "Bb5",
      source_san_path: ["e4", "e5", "Nf3", "Nc6"],
      source: "checkpoint",
      checkpoint_id: "checkpoint:second",
    },
  ],
  omitted_drill_count: 0,
  causal_move_san: "Nf3",
  san_paths: [["e4", "e5", "Nf3", "Nc6", "Bb5"]],
  omitted_san_path_count: 0,
  moves: ["Bb5", "Nc6", "Nf3", "e4", "e5"],
  omitted_move_count: 0,
};

const grounded: StrategicFitPlanCardInput = {
  title: "Hold the Nf3 setup",
  sections: [
    {
      kind: "strategic-plan",
      text: "Keep the kingside setup and finish development before committing in the center.",
      concept_ids: ["setup-family.castling.repertoire.kingside"],
    },
    {
      kind: "model-position",
      text: "Play the position after e4 e5 and answer with Nf3 until it is automatic.",
      drill_ids: ["strategic-fit-drill:one"],
      checkpoint_ids: ["checkpoint:opening"],
    },
  ],
};

const code = (input: StrategicFitPlanCardInput, evidence = EVIDENCE): string => {
  try {
    resolveStrategicFitPlanCard(input, evidence);
    return "accepted";
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
};

const section = (overrides: Record<string, unknown>): StrategicFitPlanCardInput => ({
  title: "Plan",
  sections: [
    {
      kind: "strategic-plan",
      text: "Finish development.",
      concept_ids: ["concept:center-control"],
      ...overrides,
    },
  ],
});

test("a grounded plan resolves with the evidence and moves each section actually cites", () => {
  const card = resolveStrategicFitPlanCard(grounded, EVIDENCE);
  assert.equal(card.plan_card_version, "1.0.0");
  assert.equal(card.title, "Hold the Nf3 setup");
  assert.equal(card.training_id, EVIDENCE.training_id);
  assert.equal(card.evidence_identity, strategicFitPlanEvidenceIdentity(EVIDENCE));
  assert.deepEqual(
    card.sections.map((entry) => entry.kind),
    ["strategic-plan", "model-position"],
  );
  assert.deepEqual(card.sections[0]!.concept_ids, ["setup-family.castling.repertoire.kingside"]);
  assert.deepEqual(card.sections[0]!.cited_moves, [], "prose without moves cites none");
  assert.deepEqual(
    card.sections[1]!.cited_moves,
    ["e4", "e5", "Nf3"],
    "every mentioned move is resolved",
  );
  assert.deepEqual(card.sections[1]!.drill_ids, ["strategic-fit-drill:one"]);
  const rendered = renderStrategicFitPlanCardText(card);
  assert.equal(rendered.includes("Plan: Keep the kingside setup"), true);
  assert.equal(rendered.includes("Model position:"), true);
  assert.equal(
    rendered.includes("strategic-fit-drill:one"),
    true,
    "durable text keeps the support",
  );
  assert.equal(strategicFitPlanSectionLabel("danger-sign"), "Danger sign");
  assert.equal(STRATEGIC_FIT_PLAN_SECTION_KINDS.length, 6);
});

test("a section must cite evidence, and only evidence this finding returned", () => {
  assert.equal(code(section({})), "accepted");
  assert.equal(
    code(section({ concept_ids: undefined })),
    "strategic_fit_plan_missing_support",
    "an observation with nothing behind it is refused",
  );
  assert.equal(
    code(section({ concept_ids: ["concept:invented"] })),
    "strategic_fit_plan_unsupported_concept",
  );
  assert.equal(
    code(section({ concept_ids: undefined, checkpoint_ids: ["checkpoint:invented"] })),
    "strategic_fit_plan_unsupported_checkpoint",
  );
  assert.equal(
    code(section({ concept_ids: undefined, drill_ids: ["strategic-fit-drill:invented"] })),
    "strategic_fit_plan_unsupported_drill",
  );
  assert.equal(code({ title: "Plan", sections: [] }), "strategic_fit_plan_empty");
  assert.equal(
    code({
      title: "Plan",
      sections: [{ kind: "tactical-shot", text: "x", concept_ids: ["concept:center-control"] }],
    }),
    "strategic_fit_plan_invalid_section",
  );
  assert.equal(
    code({
      title: "Plan",
      sections: [
        {
          kind: "strategic-plan",
          text: "x",
          concept_ids: ["concept:center-control"],
          rationale: "y",
        },
      ],
    }),
    "strategic_fit_plan_invalid_section",
    "an unknown section field is rejected rather than ignored",
  );
});

test("moves from mutually exclusive branches cannot be combined into one plan line", () => {
  const branched: StrategicFitPlanEvidence = {
    ...EVIDENCE,
    san_paths: [
      ["e4", "e5", "Nf3"],
      ["d4", "d5", "c4"],
    ],
    moves: ["c4", "d4", "d5", "e4", "e5", "Nf3"],
  };
  assert.equal(
    code(section({ text: "Play e4, then answer with d5." }), branched),
    "strategic_fit_plan_unsupported_move",
    "each token exists in the evidence union, but no validated path contains the sequence",
  );
  assert.equal(
    code(
      section({
        kind: "model-position",
        text: "Play d4 from this drill position.",
        concept_ids: undefined,
        drill_ids: ["strategic-fit-drill:one"],
      }),
      branched,
    ),
    "strategic_fit_plan_unsupported_move",
    "a drill-anchored section is validated against that drill's source path, not another branch",
  );
});

test("a move the validated paths do not contain cannot be written into a plan", () => {
  assert.equal(
    code(section({ text: "Prepare the f5 break as soon as the center is closed." })),
    "strategic_fit_plan_unsupported_move",
    "an invented pawn break is exactly the claim that must fail",
  );
  assert.equal(
    code(section({ text: "Meet it with Nf3 and keep the knight there." })),
    "accepted",
    "a move on a validated path stays writable",
  );
  assert.equal(
    code(section({ text: "After 1.e4 e5 2.Nf3, develop." })),
    "accepted",
    "move numbers are not moves",
  );
  assert.equal(
    code({ title: "Win with Qh5", sections: grounded.sections }),
    "strategic_fit_plan_unsupported_move",
    "the title is scanned too",
  );
  assert.deepEqual(strategicFitPlanMoveMentions("Play Nf3! then O-O, not 15.Qxd8+."), [
    "Nf3",
    "O-O",
    "Qxd8+",
  ]);
  assert.deepEqual(strategicFitPlanMoveMentions("Keep the pieces active and the king safe."), []);
});

test("checking and mating SAN remain canonical evidence mentions", () => {
  const evidence: StrategicFitPlanEvidence = {
    ...EVIDENCE,
    san_paths: [...EVIDENCE.san_paths, ["Qxd8+"], ["Qh7#"]],
    moves: [...EVIDENCE.moves, "Qxd8+", "Qh7#"],
  };
  const checking = resolveStrategicFitPlanCard(
    section({ text: "After Qxd8+, consolidate.", concept_ids: ["concept:center-control"] }),
    evidence,
  );
  const mating = resolveStrategicFitPlanCard(
    section({ text: "Finish with Qh7#.", concept_ids: ["concept:center-control"] }),
    evidence,
  );
  assert.deepEqual(checking.sections[0]!.cited_moves, ["Qxd8+"]);
  assert.deepEqual(mating.sections[0]!.cited_moves, ["Qh7#"]);
});

test("an outside model game is refused however it is introduced", () => {
  assert.equal(
    code(section({ text: "This is the plan from Kasparov–Karpov, a famous encounter." })),
    "strategic_fit_plan_unsupported_model_game",
  );
  assert.equal(
    code(section({ text: "Compare the classic 1993 treatment of this structure." })),
    "strategic_fit_plan_unsupported_model_game",
  );
  assert.equal(
    code({ title: "The 1993 plan", sections: grounded.sections }),
    "strategic_fit_plan_unsupported_model_game",
  );
  assert.equal(
    code(section({ kind: "model-position", drill_ids: undefined })),
    "strategic_fit_plan_unsupported_model_game",
    "a model position must be one of the finding's own drill positions",
  );
  assert.equal(
    code(section({ kind: "model-position", drill_ids: ["strategic-fit-drill:two"] })),
    "accepted",
  );
});

test("bounds are enforced as errors rather than trimmed to fit", () => {
  const limits = STRATEGIC_FIT_PLAN_LIMITS;
  assert.equal(
    code({ title: "", sections: grounded.sections }),
    "strategic_fit_plan_invalid_value",
  );
  assert.equal(
    code({ title: "t".repeat(limits.title_characters + 1), sections: grounded.sections }),
    "strategic_fit_plan_invalid_value",
  );
  assert.equal(code(section({ text: "   " })), "strategic_fit_plan_invalid_value");
  assert.equal(
    code(section({ text: "t".repeat(limits.section_text_characters + 1) })),
    "strategic_fit_plan_invalid_value",
  );
  assert.equal(
    code({
      title: "Plan",
      sections: Array.from({ length: limits.sections + 1 }, () => ({
        kind: "strategic-plan",
        text: "Develop.",
        concept_ids: ["concept:center-control"],
      })),
    }),
    "strategic_fit_plan_invalid_value",
  );
  assert.equal(
    code(
      section({
        concept_ids: Array.from(
          { length: limits.section_anchors + 1 },
          () => "concept:center-control",
        ),
      }),
    ),
    "strategic_fit_plan_invalid_value",
  );
  const empty: StrategicFitPlanEvidence = {
    ...EVIDENCE,
    concept_ids: [],
    checkpoints: [],
    drills: [],
  };
  assert.equal(code(grounded, empty), "strategic_fit_plan_evidence_unavailable");
  try {
    resolveStrategicFitPlanCard(section({ concept_ids: ["concept:invented"] }), EVIDENCE);
    assert.fail("an unsupported concept must throw");
  } catch (error) {
    const result = strategicFitPlanErrorResult(error);
    assert.equal(result.error, "strategic_fit_plan_unsupported_concept");
    assert.match(result.reason, /concept:center-control/, "the reason names what may be cited");
  }
  assert.throws(
    () => strategicFitPlanErrorResult(new Error("something else")),
    /something else/,
    "only plan errors become a structured result",
  );
});

test("a resolved card is re-checked against current evidence and fails closed when it moved", () => {
  const card = resolveStrategicFitPlanCard(grounded, EVIDENCE);
  assert.deepEqual(assertStrategicFitPlanCardSupported(card, EVIDENCE), card);

  const withoutDrill: StrategicFitPlanEvidence = {
    ...EVIDENCE,
    drills: EVIDENCE.drills.filter((drill) => drill.drill_id !== "strategic-fit-drill:one"),
  };
  assert.throws(
    () => assertStrategicFitPlanCardSupported(card, withoutDrill),
    (error: { code?: string }) => error.code === "strategic_fit_plan_unsupported_drill",
  );

  const reanalyzed: StrategicFitPlanEvidence = { ...EVIDENCE, moves: [...EVIDENCE.moves, "d4"] };
  assert.throws(
    () => assertStrategicFitPlanCardSupported(card, reanalyzed),
    (error: { code?: string }) => error.code === "strategic_fit_plan_stale",
  );
  assert.throws(
    () =>
      assertStrategicFitPlanCardSupported(
        { ...card, plan_card_version: "0.9.0" as never },
        EVIDENCE,
      ),
    (error: { code?: string }) => error.code === "strategic_fit_plan_invalid_value",
  );
});

test("the evidence identity changes with the evidence and ignores its ordering", () => {
  const identity = strategicFitPlanEvidenceIdentity(EVIDENCE);
  assert.equal(
    strategicFitPlanEvidenceIdentity({
      ...EVIDENCE,
      concept_ids: [...EVIDENCE.concept_ids].reverse(),
    }),
    identity,
    "ordering is not evidence",
  );
  assert.equal(
    strategicFitPlanEvidenceIdentity({ ...EVIDENCE, omitted_concept_count: 99 }),
    identity,
    "a disclosure count is not part of what a card rests on",
  );
  for (const changed of [
    { concept_ids: [] },
    { checkpoints: [] },
    { drills: EVIDENCE.drills.slice(1) },
    { causal_move_san: null },
    { moves: EVIDENCE.moves.slice(1) },
    { training_id: "strategic-fit-training:other" },
    { repertoire_revision: "browser:5" },
  ] as const) {
    assert.notEqual(
      strategicFitPlanEvidenceIdentity({ ...EVIDENCE, ...changed }),
      identity,
      `${Object.keys(changed)[0]} must change the identity`,
    );
  }
});
