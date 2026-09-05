import assert from "node:assert/strict";
import test from "node:test";

import {
  DOMINANT_OPENING_COVERAGE_THRESHOLD,
  cohortNameIndex,
  deriveCohortNames,
  formatCohortLabel,
} from "../src/store/strategic-fit-names.ts";

type NameInput = Parameters<typeof deriveCohortNames>[0];

const cohort = (id: string, routeCount: number) =>
  ({
    cohort_id: id,
    route_ids: Array.from({ length: routeCount }, (_, index) => `route:${id}:${index}`),
  }) as unknown as NameInput["cohorts"][number];

const finding = (cohortId: string, openingScope: string, index = 0) =>
  ({
    finding_id: `finding:${cohortId}:${index}`,
    opening_scope: openingScope,
    evidence: { cohort_id: cohortId },
  }) as unknown as NameInput["findings"][number];

test("a dominant opening at or above the threshold names the cohort", () => {
  const [name] = deriveCohortNames({
    cohorts: [cohort("cohort:aaaaaaaaaaaaaaaa", 5)],
    findings: [
      finding("cohort:aaaaaaaaaaaaaaaa", "Sicilian Defense", 0),
      finding("cohort:aaaaaaaaaaaaaaaa", "Sicilian Defense", 1),
      finding("cohort:aaaaaaaaaaaaaaaa", "Sicilian Defense", 2),
      finding("cohort:aaaaaaaaaaaaaaaa", "French Defense", 3),
    ],
  });

  assert.ok(name);
  assert.equal(name.name, "Sicilian Defense");
  assert.equal(name.derivedFromOpening, true);
  assert.equal(name.disambiguator, null);
});

test("exactly one half coverage still names the cohort — the threshold is inclusive", () => {
  const [name] = deriveCohortNames({
    cohorts: [cohort("cohort:bbbbbbbbbbbbbbbb", 2)],
    findings: [
      finding("cohort:bbbbbbbbbbbbbbbb", "Caro-Kann Defense", 0),
      finding("cohort:bbbbbbbbbbbbbbbb", "Caro-Kann Defense", 1),
      finding("cohort:bbbbbbbbbbbbbbbb", "Pirc Defense", 2),
      finding("cohort:bbbbbbbbbbbbbbbb", "Modern Defense", 3),
    ],
  });

  assert.ok(name);
  assert.equal(2 / 4, DOMINANT_OPENING_COVERAGE_THRESHOLD);
  assert.equal(name.name, "Caro-Kann Defense");
  assert.equal(name.derivedFromOpening, true);
});

test("below one half coverage falls back rather than misnaming a mixed cohort", () => {
  const [name] = deriveCohortNames({
    cohorts: [cohort("cohort:cccccccccccccccc", 9)],
    findings: [
      finding("cohort:cccccccccccccccc", "Sicilian Defense", 0),
      finding("cohort:cccccccccccccccc", "Sicilian Defense", 1),
      finding("cohort:cccccccccccccccc", "French Defense", 2),
      finding("cohort:cccccccccccccccc", "Caro-Kann Defense", 3),
      finding("cohort:cccccccccccccccc", "Pirc Defense", 4),
    ],
  });

  assert.ok(name);
  assert.equal(name.name, "Comparison group 1");
  assert.equal(name.derivedFromOpening, false);
  assert.equal(name.label, "Comparison group 1 (9 lines)");
});

test("a cohort with no findings falls back — there is no evidence to name it from", () => {
  const [name] = deriveCohortNames({
    cohorts: [cohort("cohort:dddddddddddddddd", 3)],
    findings: [],
  });

  assert.ok(name);
  assert.equal(name.name, "Comparison group 1");
  assert.equal(name.derivedFromOpening, false);
});

test("two cohorts resolving to the same opening are visibly disambiguated", () => {
  const names = deriveCohortNames({
    cohorts: [cohort("cohort:1111111111111111", 4), cohort("cohort:2222222222222222", 6)],
    findings: [
      finding("cohort:1111111111111111", "Sicilian Defense", 0),
      finding("cohort:2222222222222222", "Sicilian Defense", 1),
    ],
  });

  assert.deepEqual(
    names.map((entry) => entry.name),
    ["Sicilian Defense 1", "Sicilian Defense 2"],
  );
  assert.equal(new Set(names.map((entry) => entry.label)).size, 2);
  assert.deepEqual(
    names.map((entry) => entry.disambiguator),
    [1, 2],
  );
});

test("a name that does not collide is never numbered", () => {
  const names = deriveCohortNames({
    cohorts: [cohort("cohort:3333333333333333", 2), cohort("cohort:4444444444444444", 3)],
    findings: [
      finding("cohort:3333333333333333", "Sicilian Defense", 0),
      finding("cohort:4444444444444444", "French Defense", 1),
    ],
  });

  assert.deepEqual(
    names.map((entry) => entry.name),
    ["Sicilian Defense", "French Defense"],
  );
  assert.deepEqual(
    names.map((entry) => entry.disambiguator),
    [null, null],
  );
});

test("numbering is stable against finding order, not just cohort order", () => {
  const cohorts = [cohort("cohort:5555555555555555", 1), cohort("cohort:6666666666666666", 1)];
  const findings = [
    finding("cohort:5555555555555555", "Sicilian Defense", 0),
    finding("cohort:6666666666666666", "Sicilian Defense", 1),
  ];

  const forward = deriveCohortNames({ cohorts, findings });
  const reversed = deriveCohortNames({ cohorts, findings: [...findings].reverse() });

  assert.deepEqual(
    forward.map((entry) => entry.name),
    reversed.map((entry) => entry.name),
  );
});

test("a tie between opening scopes resolves deterministically", () => {
  const build = (scopes: readonly string[]) =>
    deriveCohortNames({
      cohorts: [cohort("cohort:7777777777777777", 4)],
      findings: scopes.map((scope, index) => finding("cohort:7777777777777777", scope, index)),
    })[0]?.name;

  const forward = build([
    "Sicilian Defense",
    "Sicilian Defense",
    "French Defense",
    "French Defense",
  ]);
  const reversed = build([
    "French Defense",
    "French Defense",
    "Sicilian Defense",
    "Sicilian Defense",
  ]);

  assert.equal(forward, reversed);
});

test("every label states the cohort's own line count", () => {
  const names = deriveCohortNames({
    cohorts: [cohort("cohort:8888888888888888", 7), cohort("cohort:9999999999999999", 1)],
    findings: [
      finding("cohort:8888888888888888", "Sicilian Defense", 0),
      finding("cohort:9999999999999999", "French Defense", 1),
    ],
  });

  assert.deepEqual(
    names.map((entry) => entry.label),
    ["Sicilian Defense (7 lines)", "French Defense (1 line)"],
  );
  assert.deepEqual(
    names.map((entry) => entry.lineCount),
    [7, 1],
  );
});

test("formatCohortLabel singularises a single line", () => {
  assert.equal(formatCohortLabel("Comparison group 2", 1), "Comparison group 2 (1 line)");
  assert.equal(formatCohortLabel("Comparison group 2", 0), "Comparison group 2 (0 lines)");
});

test("no derived name contains a raw cohort identifier", () => {
  const names = deriveCohortNames({
    cohorts: [cohort("cohort:abcdef0123456789", 3)],
    findings: [finding("cohort:abcdef0123456789", "Sicilian Defense", 0)],
  });

  for (const entry of names) {
    assert.doesNotMatch(entry.name, /cohort:[0-9a-f]{16}/iu);
    assert.doesNotMatch(entry.label, /cohort:[0-9a-f]{16}/iu);
  }
});

test("the index keys names by the exact cohort id so lookups round-trip", () => {
  const report = {
    cohorts: [cohort("cohort:0f0f0f0f0f0f0f0f", 2)],
    findings: [finding("cohort:0f0f0f0f0f0f0f0f", "Sicilian Defense", 0)],
  };

  const index = cohortNameIndex(report);

  assert.equal(index.get("cohort:0f0f0f0f0f0f0f0f")?.name, "Sicilian Defense");
  assert.equal(index.size, report.cohorts.length);
});

test("derivation does not mutate the report it reads", () => {
  const report = {
    cohorts: [cohort("cohort:aaaa1111bbbb2222", 2)],
    findings: [finding("cohort:aaaa1111bbbb2222", "Sicilian Defense", 0)],
  };
  const before = JSON.stringify(report);

  deriveCohortNames(report);

  assert.equal(JSON.stringify(report), before);
});
