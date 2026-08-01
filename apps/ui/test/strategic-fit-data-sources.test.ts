import assert from "node:assert/strict";
import test from "node:test";

import {
  createStrategicFitDataSourceState,
  normalizeStrategicFitDataSourceSettings,
  strategicFitDataSourceArguments,
} from "../src/store/strategic-fit-data-sources.ts";

test("data-source settings normalize bounds and omit unusable personal history", () => {
  const normalized = normalizeStrategicFitDataSourceSettings({
    popularity: {
      enabled: true,
      db: "lichess",
      speeds: ["rapid", "invalid"],
      ratings: [1800, 9999],
      since: "not-a-date",
      until: "2026-07",
      max_positions: 999,
    },
    personal_history: {
      enabled: true,
      platform: "chesscom",
      username: "   ",
      max_games: -5,
      year: 1900,
      month: 20,
    },
  });

  assert.deepEqual(normalized.popularity.speeds, ["rapid"]);
  assert.deepEqual(normalized.popularity.ratings, [1800]);
  assert.equal(normalized.popularity.since, "");
  assert.equal(normalized.popularity.until, "2026-07");
  assert.equal(normalized.popularity.max_positions, 120);
  assert.equal(normalized.personal_history.max_games, 1);
  assert.equal(normalized.personal_history.year, 2007);
  assert.equal(normalized.personal_history.month, 12);
  assert.deepEqual(strategicFitDataSourceArguments(normalized), {
    popularity: {
      db: "lichess",
      speeds: ["rapid"],
      ratings: [1800],
      until: "2026-07",
      max_positions: 120,
    },
  });
});

test("recency filters match the selected database and cannot save a reversed range", () => {
  const lichess = normalizeStrategicFitDataSourceSettings({
    popularity: { db: "lichess", since: "2020", until: "2026-07" },
  });
  assert.equal(lichess.popularity.since, "");
  assert.equal(lichess.popularity.until, "2026-07");

  const masters = normalizeStrategicFitDataSourceSettings({
    popularity: { db: "masters", since: "2026", until: "2020" },
  });
  assert.equal(masters.popularity.since, "2026");
  assert.equal(masters.popularity.until, "");

  const wrongMastersFormat = normalizeStrategicFitDataSourceSettings({
    popularity: { db: "masters", since: "2020-01" },
  });
  assert.equal(wrongMastersFormat.popularity.since, "");
});

test("source changes persist once, invalidate reports once, and produce canonical host arguments", () => {
  let stored: unknown = null;
  let saves = 0;
  let invalidations = 0;
  const state = createStrategicFitDataSourceState({
    load: () => stored,
    save: (settings) => {
      stored = structuredClone(settings);
      saves++;
    },
    invalidateReports: () => {
      invalidations++;
    },
  });
  const beforeIdentity = state.identity();

  state.update({
    popularity: { enabled: true, db: "masters", since: "2020", max_positions: 40 },
    personal_history: {
      enabled: true,
      platform: "chesscom",
      username: " player-one ",
      year: 2026,
      month: 7,
    },
  });
  state.update({ popularity: { max_positions: 40 } });

  assert.notEqual(state.identity(), beforeIdentity);
  assert.equal(saves, 1);
  assert.equal(invalidations, 1);
  assert.deepEqual(stored, state.settings());
  assert.deepEqual(state.commandArguments(), {
    popularity: { db: "masters", since: "2020", max_positions: 40 },
    personal_history: { platform: "chesscom", username: "player-one", year: 2026, month: 7 },
  });

  const reloaded = createStrategicFitDataSourceState({
    load: () => stored,
    save: () => undefined,
    invalidateReports: () => undefined,
  });
  assert.deepEqual(reloaded.settings(), state.settings());
});
