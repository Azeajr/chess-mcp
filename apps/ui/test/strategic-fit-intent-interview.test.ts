import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_INTENT_LIMITS,
  contractsForHost,
  createDefaultStrategicFitDocumentMetadata,
  diffStrategicFitProfiles,
  isStrategicConceptId,
  jsonSchemaForTool,
  normalizeStrategicFitDocumentMetadata,
  resolveStrategicFitIntentPatch,
  toolContract,
  validateToolArguments,
  type StrategicFitDocumentMetadata,
  type StrategicFitProfile,
} from "@chess-mcp/chess-tools";
import { streamChat } from "../src/llm/openrouter.ts";
import { executeBrowserCommand } from "../src/application/browser-commands/client.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import { createStrategicFitProfileState } from "../src/store/strategic-fit-profile.ts";
import {
  createStrategicFitIntentInterviewState,
  type StrategicFitProfileProposalResult,
} from "../src/store/strategic-fit-intent-interview.ts";

const CONCEPT = "setup-family.castling.repertoire.kingside";
const OTHER_CONCEPT = "endgame-tendency.queenless";

function interview(initial = createDefaultStrategicFitDocumentMetadata()) {
  const documents = new Map<string, StrategicFitDocumentMetadata>([
    ["document:a", structuredClone(initial)],
  ]);
  let documentId = "document:a";
  let revision = 7;
  let settingsIdentity = "settings:one";
  let writes = 0;
  const profileState = createStrategicFitProfileState({
    currentDocumentId: () => documentId,
    currentMetadata: () => documents.get(documentId) ?? createDefaultStrategicFitDocumentMetadata(),
    replaceMetadata: (input) => {
      writes++;
      const result = normalizeStrategicFitDocumentMetadata(input);
      documents.set(documentId, structuredClone(result.metadata));
      return result;
    },
    invalidateReports: () => {},
  });
  const state = createStrategicFitIntentInterviewState({
    currentDocumentId: () => documentId,
    currentRevision: () => revision,
    currentProfile: () => profileState.profile(),
    currentSettingsIdentity: () => settingsIdentity,
    selectProfile: (mode) => profileState.select(mode),
    updateCustom: (preferences) => profileState.updateCustom(preferences),
    now: () => "2026-07-31T00:00:00.000Z",
  });
  return {
    state,
    profile: () => profileState.profile(),
    persisted: (): StrategicFitProfile =>
      (documents.get(documentId) ?? createDefaultStrategicFitDocumentMetadata()).profile,
    writes: () => writes,
    setRevision: (next: number) => {
      revision = next;
    },
    setSettingsIdentity: (next: string) => {
      settingsIdentity = next;
    },
    setDocument: (next: string) => {
      documentId = next;
      if (!documents.has(next)) documents.set(next, createDefaultStrategicFitDocumentMetadata());
    },
    editProfileOutOfBand: () => profileState.select("versatile"),
  };
}

test("the canonical proposal contract is browser-only, action-shaped, and stages nothing", () => {
  const contract = toolContract("propose_strategic_fit_profile");
  assert.deepEqual([...contract.hosts], ["browser"]);
  assert.equal(contract.result.kind, "action");
  assert.match(contract.result.semantics ?? "", /Proposing changes nothing/);
  assert.equal(
    contractsForHost("mcp").some((entry) => entry.name === "propose_strategic_fit_profile"),
    false,
    "MCP keeps no document profile, so it must not advertise a staged proposal",
  );
  assert.equal(jsonSchemaForTool("propose_strategic_fit_profile", "mcp"), null);
  const browser = jsonSchemaForTool("propose_strategic_fit_profile", "browser")!;
  assert.deepEqual(Object.keys(browser.properties as Record<string, unknown>).sort(), [
    "mode",
    "preferences",
    "rationale",
  ]);
  assert.equal("required" in browser, false, "either half of the proposal may be omitted");
});

test("canonical validation rejects malformed, empty, and self-contradictory proposals", () => {
  const check = (args: Record<string, unknown>) =>
    validateToolArguments("propose_strategic_fit_profile", args, "browser");
  assert.equal(check({ mode: "versatile" }).ok, true);
  assert.equal(check({ preferences: { additional_memorization_tolerance: 0.25 } }).ok, true);
  assert.equal(check({}).reason, "a profile proposal requires mode, preferences, or both");
  assert.equal(
    check({ preferences: {} }).reason,
    "preferences must contain at least one preference",
  );
  assert.equal(
    check({ preferences: { feature_family_weights: {} } }).reason,
    "preferences.feature_family_weights must contain at least one signal family",
  );
  assert.equal(
    check({ preferences: { preferred_concept_ids: [CONCEPT], avoided_concept_ids: [CONCEPT] } })
      .reason,
    `${CONCEPT} cannot be both preferred and avoided`,
  );
  assert.equal(check({ mode: "aggressive" }).ok, false);
  assert.equal(check({ preferences: { additional_memorization_tolerance: 1.5 } }).ok, false);
  assert.equal(check({ preferences: { maximum_engine_loss_cp: 2000 } }).ok, false);
  assert.equal(check({ preferences: { theory_volume: 3 } }).ok, false);
  assert.equal(check({ preferences: { preferred_concept_ids: ["Invent A Concept"] } }).ok, false);
  assert.equal(
    check({
      rationale: "x".repeat(STRATEGIC_FIT_INTENT_LIMITS.rationale_characters + 1),
      mode: "balanced",
    }).ok,
    false,
  );
});

test("patch resolution rejects out-of-range values and invented concepts instead of adjusting them", () => {
  const code = (input: Record<string, unknown>) => {
    try {
      resolveStrategicFitIntentPatch(input);
      return "accepted";
    } catch (error) {
      return (error as { code?: string }).code ?? "unknown";
    }
  };
  assert.equal(code({}), "strategic_fit_intent_empty_proposal");
  assert.equal(code({ mode: "sharp" }), "strategic_fit_intent_invalid_mode");
  assert.equal(
    code({ preferences: { unknown_preference: 1 } }),
    "strategic_fit_intent_unknown_field",
  );
  assert.equal(
    code({ preferences: { feature_family_weights: { tempo: 1 } } }),
    "strategic_fit_intent_unknown_field",
  );
  assert.equal(
    code({ preferences: { manual_weight_importance: 4 } }),
    "strategic_fit_intent_invalid_value",
  );
  assert.equal(
    code({ preferences: { manual_weight_importance: Number.NaN } }),
    "strategic_fit_intent_invalid_value",
  );
  assert.equal(
    code({ preferences: { maximum_engine_loss_cp: 12.5 } }),
    "strategic_fit_intent_invalid_value",
  );
  assert.equal(
    code({ preferences: { feature_family_weights: { "pawn-topology": 9 } } }),
    "strategic_fit_intent_invalid_value",
  );
  assert.equal(
    code({ preferences: { preferred_concept_ids: ["concept:iqp"] } }),
    "strategic_fit_intent_invalid_concept_id",
  );
  assert.equal(
    code({ preferences: { preferred_tactical_character: ["Very Sharp"] } }),
    "strategic_fit_intent_invalid_value",
  );
  assert.equal(
    code({ preferences: { preferred_concept_ids: [CONCEPT], avoided_concept_ids: [CONCEPT] } }),
    "strategic_fit_intent_conflicting_concepts",
  );
  assert.equal(
    code({ mode: "custom", preferences: { manual_weight_importance: 0.5 } }),
    "accepted",
  );

  const patch = resolveStrategicFitIntentPatch({
    preferences: {
      preferred_concept_ids: [CONCEPT, CONCEPT],
      avoided_concept_ids: [OTHER_CONCEPT],
    },
    rationale: "  low theory  ",
  });
  assert.deepEqual(
    patch.preferences?.preferred_concept_ids,
    [CONCEPT],
    "duplicates collapse without failing",
  );
  assert.equal(patch.rationale, "low theory");
  assert.equal(patch.mode, null);
  assert.equal(patch.touches_preferences, true);
  assert.equal(isStrategicConceptId(CONCEPT), true);
  assert.equal(
    isStrategicConceptId("setup-family"),
    false,
    "a bare namespace is not a concept identity",
  );
});

test("a patch cannot add an avoided concept that the existing profile already prefers", () => {
  const base = createDefaultStrategicFitDocumentMetadata();
  const initial: StrategicFitDocumentMetadata = {
    ...base,
    profile: {
      ...base.profile,
      mode: "custom",
      source: "explicit",
      provisional: false,
      preferences: {
        ...base.profile.preferences,
        preferred_concept_ids: [CONCEPT],
        avoided_concept_ids: [],
      },
    },
  };
  const session = interview(initial);

  assert.throws(
    () =>
      session.state.propose({
        preferences: { avoided_concept_ids: [CONCEPT] },
        rationale: "A later message cannot contradict already confirmed intent.",
      }),
    (error: { code?: string }) => error.code === "strategic_fit_intent_conflicting_concepts",
  );
  assert.equal(session.state.proposals().length, 0, "the contradictory result is never staged");
  assert.equal(session.writes(), 0, "validation changes no profile metadata");
});

test("a patch cannot add a preferred concept that the existing profile already avoids", () => {
  const base = createDefaultStrategicFitDocumentMetadata();
  const initial: StrategicFitDocumentMetadata = {
    ...base,
    profile: {
      ...base.profile,
      mode: "custom",
      source: "explicit",
      provisional: false,
      preferences: {
        ...base.profile.preferences,
        preferred_concept_ids: [],
        avoided_concept_ids: [CONCEPT],
      },
    },
  };
  const session = interview(initial);

  assert.throws(
    () => session.state.propose({ preferences: { preferred_concept_ids: [CONCEPT] } }),
    (error: { code?: string }) => error.code === "strategic_fit_intent_conflicting_concepts",
  );
  assert.equal(session.state.proposals().length, 0);
});

test("a proposal reports the exact diff and persists nothing until it is accepted", () => {
  const session = interview();
  const before = session.profile();
  const proposal = session.state.propose({
    mode: "custom",
    preferences: {
      additional_memorization_tolerance: 0.2,
      maximum_engine_loss_cp: 40,
      avoided_concept_ids: [OTHER_CONCEPT],
      feature_family_weights: { "learning-concepts": 2 },
    },
    rationale: "The user asked for a low-theory repertoire.",
  });
  assert.equal(proposal.kind, "strategic_fit_profile_proposal");
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.persisted, false);
  assert.equal(proposal.scope, "profile-preferences-only");
  assert.equal(proposal.resulting_mode, "custom");
  assert.equal(
    proposal.confirms_provisional_profile,
    true,
    "the default profile is still provisional",
  );
  assert.deepEqual(proposal.diff.map((entry) => entry.field).sort(), [
    "mode",
    "preferences.additional_memorization_tolerance",
    "preferences.avoided_concept_ids",
    "preferences.feature_family_weights.learning-concepts",
    "preferences.maximum_engine_loss_cp",
  ]);
  const tolerance = proposal.diff.find(
    (entry) => entry.field === "preferences.additional_memorization_tolerance",
  )!;
  assert.deepEqual(
    [tolerance.current, tolerance.proposed],
    [before.preferences.additional_memorization_tolerance, 0.2],
  );
  assert.equal(
    JSON.stringify(proposal).includes("profile_identity"),
    false,
    "identities stay host-side",
  );

  assert.deepEqual(session.profile(), before, "the effective profile is untouched while pending");
  assert.deepEqual(session.persisted(), before);
  assert.equal(session.writes(), 0, "a proposal performs no metadata write");
  assert.equal(session.persisted().provisional, true, "an unconfirmed inference stays provisional");
});

test("accepting commits through the profile state; rejecting leaves no trace", () => {
  const session = interview();
  const accepted = session.state.propose({ preferences: { manual_weight_importance: 0.9 } });
  const result = session.state.accept(accepted.proposal_id);
  assert.equal(result.ok, true);
  assert.equal(session.state.proposal(accepted.proposal_id)?.status, "accepted");
  assert.equal(session.writes(), 1);
  assert.equal(session.persisted().preferences.manual_weight_importance, 0.9);
  assert.equal(session.persisted().source, "explicit");
  assert.equal(session.persisted().provisional, false, "acceptance is what makes intent durable");
  assert.equal(session.persisted().mode, "custom");
  assert.equal(
    session.state.accept(accepted.proposal_id).ok,
    false,
    "an accepted proposal cannot be replayed",
  );

  const rejected = session.state.propose({ preferences: { manual_weight_importance: 0.1 } });
  const snapshot = session.persisted();
  assert.equal(session.state.reject(rejected.proposal_id).ok, true);
  assert.equal(session.state.proposal(rejected.proposal_id)?.status, "rejected");
  assert.deepEqual(session.persisted(), snapshot, "rejection changes nothing");
  assert.equal(session.writes(), 1);
  const replayed = session.state.accept(rejected.proposal_id);
  assert.equal(replayed.ok, false);
  assert.equal(
    replayed.ok === false && replayed.error,
    "strategic_fit_intent_proposal_not_pending",
  );
});

test("a bare preset selection is applied as that preset rather than a custom profile", () => {
  const session = interview();
  const proposal = session.state.propose({ mode: "versatile" });
  assert.equal(proposal.resulting_mode, "versatile");
  assert.deepEqual(
    proposal.diff.map((entry) => entry.field),
    ["mode"],
  );
  assert.equal(session.state.accept(proposal.proposal_id).ok, true);
  assert.equal(session.persisted().mode, "versatile");
  assert.equal(session.persisted().source, "explicit");
});

test("a value-identical proposal confirms a provisional profile but is refused once intent is explicit", () => {
  const session = interview();
  const confirmation = session.state.propose({ mode: session.profile().mode });
  assert.deepEqual(confirmation.diff, [], "no setting changes");
  assert.equal(
    confirmation.confirms_provisional_profile,
    true,
    "accepting still converts the inferred default",
  );
  assert.equal(session.state.accept(confirmation.proposal_id).ok, true);
  assert.equal(session.persisted().provisional, false);

  assert.throws(
    () => session.state.propose({ mode: session.profile().mode }),
    (error: { code?: string }) => error.code === "strategic_fit_intent_no_change",
  );
});

test("a proposal fails closed once the revision, settings, profile, or document moves", () => {
  for (const [label, disturb] of [
    ["revision", (session: ReturnType<typeof interview>) => session.setRevision(8)],
    [
      "settings",
      (session: ReturnType<typeof interview>) => session.setSettingsIdentity("settings:two"),
    ],
    [
      "profile",
      (session: ReturnType<typeof interview>) => {
        session.editProfileOutOfBand();
      },
    ],
    ["document", (session: ReturnType<typeof interview>) => session.setDocument("document:b")],
  ] as const) {
    const session = interview();
    const proposal = session.state.propose({
      preferences: { opponent_popularity_importance: 0.8 },
    });
    const writesBefore = session.writes();
    disturb(session);
    const result = session.state.accept(proposal.proposal_id);
    assert.equal(result.ok, false, `${label} change must invalidate the proposal`);
    assert.equal(result.ok === false && result.error, "strategic_fit_intent_proposal_stale");
    assert.equal(session.state.proposal(proposal.proposal_id)?.status, "stale");
    assert.equal(
      session.persisted().preferences.opponent_popularity_importance !== 0.8,
      true,
      `${label} change must not let the stale proposal apply`,
    );
    assert.equal(
      session.writes(),
      writesBefore + (label === "profile" ? 1 : 0),
      `${label}: no write from the stale accept`,
    );
  }
});

test("the diff compares two profiles field by field and omits everything unchanged", () => {
  const base = createDefaultStrategicFitDocumentMetadata().profile;
  assert.deepEqual(diffStrategicFitProfiles(base, base), []);
  const changed: StrategicFitProfile = {
    ...base,
    mode: "custom",
    preferences: {
      ...base.preferences,
      minimum_opponent_coverage: 0.95,
      feature_family_weights: {
        ...base.preferences.feature_family_weights,
        "center-dynamics": 2.5,
      },
    },
  };
  assert.deepEqual(diffStrategicFitProfiles(base, changed), [
    { field: "mode", label: "Profile mode", current: base.mode, proposed: "custom" },
    {
      field: "preferences.minimum_opponent_coverage",
      label: "Minimum opponent coverage",
      current: base.preferences.minimum_opponent_coverage,
      proposed: 0.95,
    },
    {
      field: "preferences.feature_family_weights.center-dynamics",
      label: "Center dynamics weight",
      current: base.preferences.feature_family_weights["center-dynamics"],
      proposed: 2.5,
    },
  ]);
});

test("a fake model's proposal reaches the browser command, stages only, and never edits the repertoire", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: { location: { origin: "http://test" } },
    configurable: true,
  });
  const proposalArguments = JSON.stringify({
    mode: "custom",
    preferences: { additional_memorization_tolerance: 0.15, avoided_concept_ids: [OTHER_CONCEPT] },
    rationale: "The user wants low theory and no queenless endgames.",
  });
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "p1",
                          function: {
                            name: "propose_strategic_fit_profile",
                            arguments: proposalArguments,
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              })}\n\n`,
            ),
          );
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

  const stream = await streamChat({
    apiKey: "x",
    model: "fake",
    messages: [],
    tools: [],
    onText() {},
  });
  assert.equal(stream.toolCalls.length, 1);
  const call = stream.toolCalls[0]!;
  assert.equal(call.function.name, "propose_strategic_fit_profile");

  const staged: unknown[] = [];
  const treeBefore = defaultBrowserCommandDependencies.currentPgn();
  const revisionBefore = defaultBrowserCommandDependencies.currentRevision();
  const result = (await executeBrowserCommand(
    call.function.name,
    JSON.parse(call.function.arguments) as Record<string, unknown>,
    {},
    {
      ...defaultBrowserCommandDependencies,
      proposeStrategicFitProfile: (input) => {
        staged.push(input);
        return {
          kind: "strategic_fit_profile_proposal",
          proposal_id: "strategic-fit-profile-proposal:1",
          status: "pending",
        };
      },
      stageEdit: () => assert.fail("a profile proposal must never stage a repertoire edit"),
      proposeLine: () => assert.fail("a profile proposal must never propose a line"),
    },
  )) as StrategicFitProfileProposalResult;
  assert.equal(result.kind, "strategic_fit_profile_proposal");
  assert.equal(staged.length, 1);
  assert.deepEqual(staged[0], JSON.parse(proposalArguments));
  assert.equal(
    defaultBrowserCommandDependencies.currentPgn(),
    treeBefore,
    "the repertoire PGN is unchanged",
  );
  assert.equal(
    defaultBrowserCommandDependencies.currentRevision(),
    revisionBefore,
    "the document revision is unchanged",
  );

  const rejected = (await executeBrowserCommand(
    "propose_strategic_fit_profile",
    { preferences: { preferred_concept_ids: ["totally made up"] } },
    {},
    defaultBrowserCommandDependencies,
  )) as { error: string };
  assert.equal(rejected.error, "invalid_arguments", "an invented concept never reaches the store");
});

test("the real browser command stages a proposal without writing profile metadata", async () => {
  const revisionBefore = defaultBrowserCommandDependencies.currentRevision();
  const pgnBefore = defaultBrowserCommandDependencies.currentPgn();
  const profileBefore = JSON.stringify(
    defaultBrowserCommandDependencies.currentStrategicFitProfile(),
  );
  const result = (await executeBrowserCommand(
    "propose_strategic_fit_profile",
    { preferences: { minimum_opponent_coverage: 0.9 }, rationale: "Keep 90% coverage." },
    {},
    defaultBrowserCommandDependencies,
  )) as StrategicFitProfileProposalResult;
  assert.equal(result.kind, "strategic_fit_profile_proposal");
  assert.equal(result.persisted, false);
  assert.equal(
    result.diff.some((entry) => entry.field === "preferences.minimum_opponent_coverage"),
    true,
  );
  assert.equal(
    JSON.stringify(defaultBrowserCommandDependencies.currentStrategicFitProfile()),
    profileBefore,
  );
  assert.equal(defaultBrowserCommandDependencies.currentRevision(), revisionBefore);
  assert.equal(defaultBrowserCommandDependencies.currentPgn(), pgnBefore);
});
