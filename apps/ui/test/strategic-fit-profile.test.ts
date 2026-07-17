import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  completeStrategicFitReport,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  strategicFitCompleteAnalysisOptions,
  type AnalyzeStrategicFitOptions,
  type StrategicFitDocumentMetadata,
  type StrategicFitProfile,
} from "@chess-mcp/chess-tools";
import { executeDirectBrowserCommand } from "../src/store/commands.ts";
import { actions, currentTree, version } from "../src/store/game.ts";
import {
  createStrategicFitProfileState,
  normalizeStrategicFitProfilePreferences,
  strategicFitPresetProfile,
} from "../src/store/strategic-fit-profile.ts";
import { StrategicFitReportCache } from "../src/application/strategic-fit-report-cache.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";

function memoryProfileState(initial = createDefaultStrategicFitDocumentMetadata()) {
  let metadata = structuredClone(initial);
  let replacements = 0;
  let invalidations = 0;
  const state = createStrategicFitProfileState({
    currentMetadata: () => metadata,
    replaceMetadata: (input) => {
      replacements++;
      const result = normalizeStrategicFitDocumentMetadata(input);
      metadata = structuredClone(result.metadata);
      return result;
    },
    invalidateReports: () => { invalidations++; },
  });
  return {
    state,
    metadata: () => metadata,
    replacements: () => replacements,
    invalidations: () => invalidations,
  };
}

test("Balanced is canonical and all four profile modes use the documented optional defaults", () => {
  const defaults = createDefaultStrategicFitDocumentMetadata().profile;
  assert.equal(defaults.mode, "balanced");
  assert.equal(defaults.source, "inferred");
  assert.equal(defaults.provisional, true);
  assert.deepEqual(defaults.preferences, {
    maximum_engine_loss_cp: null,
    opponent_popularity_importance: 0,
    personal_game_frequency_importance: 0,
    manual_weight_importance: 0,
    additional_memorization_tolerance: 0.5,
    preferred_concept_ids: [],
    avoided_concept_ids: [],
    preferred_tactical_character: [],
    minimum_opponent_coverage: null,
  });

  for (const mode of ["familiar-plans", "balanced", "versatile", "custom"] as const) {
    const preset = strategicFitPresetProfile(mode);
    assert.equal(preset.mode, mode);
    assert.equal(preset.source, "explicit");
    assert.equal(preset.provisional, false);
    assert.deepEqual(preset.preferences, defaults.preferences);
  }
});

test("a custom profile round-trips every field through canonical document metadata", () => {
  const fixture = memoryProfileState();
  const result = fixture.state.select("custom", {
    maximum_engine_loss_cp: 125,
    opponent_popularity_importance: 0.9,
    personal_game_frequency_importance: 0.7,
    manual_weight_importance: 0.4,
    additional_memorization_tolerance: 0.2,
    preferred_concept_ids: ["concept:iqp", "concept:minority-attack"],
    avoided_concept_ids: ["concept:opposite-castling"],
    preferred_tactical_character: ["forcing", "sharp"],
    minimum_opponent_coverage: 0.95,
  });

  assert.equal(result.state, "updated");
  assert.deepEqual(result.profile, fixture.metadata().profile);
  assert.equal(normalizeStrategicFitDocumentMetadata(
    JSON.parse(JSON.stringify(fixture.metadata())),
  ).state, "valid");
  assert.deepEqual(structuredClone(fixture.metadata()).profile.preferences, result.profile.preferences);
});

test("inferred profiles remain provisional, confirmation is explicit, and explicit intent wins", () => {
  const fixture = memoryProfileState();
  const inferred = fixture.state.applyInferred("versatile", {
    preferred_tactical_character: ["dynamic"],
    personal_game_frequency_importance: 0.4,
  });
  assert.equal(inferred.state, "updated");
  assert.equal(inferred.profile.source, "inferred");
  assert.equal(inferred.profile.provisional, true);

  const confirmed = fixture.state.confirmInferred();
  assert.equal(confirmed.state, "updated");
  assert.equal(confirmed.profile.source, "explicit");
  assert.equal(confirmed.profile.provisional, false);

  const ignored = fixture.state.applyInferred("familiar-plans", {
    preferred_tactical_character: ["quiet"],
  });
  assert.equal(ignored.state, "ignored-explicit");
  assert.deepEqual(ignored.profile, confirmed.profile);
  assert.equal(fixture.replacements(), 2);
  assert.equal(fixture.invalidations(), 2);
});

test("advanced values clamp deterministically while malformed edits preserve siblings and metadata", () => {
  const defaults = createDefaultStrategicFitDocumentMetadata();
  const initial: StrategicFitDocumentMetadata = {
    ...defaults,
    provenance: [{
      source_id: "fixture:metadata",
      kind: "repertoire",
      state: "available",
      version: null,
      snapshot: null,
      reason: null,
    }],
    training_references: [{
      training_id: "training:keep",
      finding_id: null,
      repertoire_revision: "revision:1",
      references: { position_ids: [], decision_ids: [], route_ids: [], source_san_paths: [] },
      created_at: "2026-07-17T12:00:00.000Z",
      provenance: [],
    }],
  };
  const fixture = memoryProfileState(initial);
  fixture.state.select("custom", {
    maximum_engine_loss_cp: 1500.7,
    opponent_popularity_importance: 2,
    personal_game_frequency_importance: -1,
    manual_weight_importance: Number.NaN,
    additional_memorization_tolerance: Number.POSITIVE_INFINITY,
    preferred_concept_ids: [" concept:iqp ", "concept:iqp", "", 42],
    avoided_concept_ids: "not-an-array",
    preferred_tactical_character: ["sharp", "sharp", "quiet"],
    minimum_opponent_coverage: -0.2,
  });
  assert.deepEqual(fixture.state.profile().preferences, {
    maximum_engine_loss_cp: 1000,
    opponent_popularity_importance: 1,
    personal_game_frequency_importance: 0,
    manual_weight_importance: 0,
    additional_memorization_tolerance: 0.5,
    preferred_concept_ids: ["concept:iqp"],
    avoided_concept_ids: [],
    preferred_tactical_character: ["sharp", "quiet"],
    minimum_opponent_coverage: 0,
  });

  fixture.state.updateCustom({
    maximum_engine_loss_cp: null,
    minimum_opponent_coverage: null,
    opponent_popularity_importance: Number.NaN,
  });
  assert.equal(fixture.state.profile().preferences.maximum_engine_loss_cp, null);
  assert.equal(fixture.state.profile().preferences.minimum_opponent_coverage, null);
  assert.equal(fixture.state.profile().preferences.opponent_popularity_importance, 1);
  assert.deepEqual(fixture.metadata().provenance, initial.provenance);
  assert.deepEqual(fixture.metadata().training_references, initial.training_references);

  assert.deepEqual(normalizeStrategicFitProfilePreferences({
    maximum_engine_loss_cp: 12.6,
  }).maximum_engine_loss_cp, 13);
});

test("profile edits invalidate reports once per semantic change without touching the game tree", () => {
  actions.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "profile-state.pgn");
  const beforePgn = actions.toPgn();
  const beforeVersion = version();
  const beforeTree = currentTree();
  const fixture = memoryProfileState();

  assert.equal(fixture.state.select("familiar-plans").state, "updated");
  assert.equal(fixture.state.select("familiar-plans").state, "unchanged");
  assert.equal(fixture.replacements(), 1);
  assert.equal(fixture.invalidations(), 1);
  assert.equal(actions.toPgn(), beforePgn);
  assert.equal(version(), beforeVersion);
  assert.equal(currentTree(), beforeTree);
});

test("report cache identity includes profile and explicit invalidation clears cached reports", async () => {
  const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *";
  let analyses = 0;
  const cache = new StrategicFitReportCache(async (source, options) => {
    analyses++;
    return analyzeStrategicFit(GameTree.fromPgn(source), options);
  });
  const base: AnalyzeStrategicFitOptions = {
    repertoireColor: "white",
    repertoireRevision: "browser:profile-cache",
  };
  await cache.getReport(pgn, { ...base, profile: strategicFitPresetProfile("balanced") });
  await cache.getReport(pgn, { ...base, profile: strategicFitPresetProfile("balanced") });
  await cache.getReport(pgn, { ...base, profile: strategicFitPresetProfile("versatile") });
  assert.equal(analyses, 2);
  cache.clear();
  assert.equal(cache.size, 0);
  await cache.getReport(pgn, { ...base, profile: strategicFitPresetProfile("versatile") });
  assert.equal(analyses, 3);
});

test("browser analysis and congruence export inherit document profile, preserve one-off overrides, and reject late profiles", async () => {
  actions.loadPgn(`1. e4 e5 *\n\n1. d4 d5 2. c4 *\n\n1. c4 *`, "profile-command.pgn");
  let documentProfile = strategicFitPresetProfile("versatile");
  let receivedProfile: StrategicFitProfile | undefined;
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    currentStrategicFitProfile: () => documentProfile,
    openings: async () => new Map(),
    analyse: async () => { throw new Error("profile-only congruence must remain engine-free"); },
    strategicFitReport: async (
      pgn: string,
      options: AnalyzeStrategicFitOptions,
    ) => {
      receivedProfile = options.profile;
      return completeStrategicFitReport(analyzeStrategicFit(
        GameTree.fromPgn(pgn),
        strategicFitCompleteAnalysisOptions(options),
      ));
    },
  };

  const inherited = await executeDirectBrowserCommand(
    "analyze_repertoire_congruence",
    {},
    {},
    dependencies,
  ) as { profile?: StrategicFitProfile };
  assert.deepEqual(receivedProfile, documentProfile);
  assert.deepEqual(inherited.profile, documentProfile);

  await executeDirectBrowserCommand(
    "analyze_repertoire_congruence",
    { profile: { mode: "familiar-plans" } },
    {},
    dependencies,
  );
  assert.equal(receivedProfile?.mode, "familiar-plans");
  assert.equal(documentProfile.mode, "versatile", "a one-off tool profile is not persisted");

  await executeDirectBrowserCommand(
    "export_annotated_repertoire",
    { include: ["congruence"] },
    {},
    dependencies,
  );
  assert.deepEqual(receivedProfile, documentProfile);

  const staleDependencies = {
    ...dependencies,
    strategicFitReport: async (pgn: string, options: AnalyzeStrategicFitOptions) => {
      const report = completeStrategicFitReport(analyzeStrategicFit(
        GameTree.fromPgn(pgn),
        strategicFitCompleteAnalysisOptions(options),
      ));
      documentProfile = strategicFitPresetProfile("balanced");
      return report;
    },
  };
  assert.deepEqual(
    await executeDirectBrowserCommand("analyze_repertoire_congruence", {}, {}, staleDependencies),
    {
      error: "strategic_fit_stale_report",
      reason: "The document Strategic Fit profile changed while analysis was running; request a fresh report.",
    },
  );
});
