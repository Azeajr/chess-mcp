import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  projectStrategicFitReport,
  type AnalyzeStrategicFitOptions,
} from "@chess-mcp/chess-tools";
import { StrategicFitReportCache } from "../src/application/strategic-fit-report-cache.ts";

const PGN = `
[Event "Cache A"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *

[Event "Cache B"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 *

[Event "Cache C"]
[Result "*"]

1. c4 e5 2. Nc3 Nf6 3. g3 d5 *`;

const options = (revision: string, extra: Partial<AnalyzeStrategicFitOptions> = {}): AnalyzeStrategicFitOptions => ({
  repertoireColor: "white",
  repertoireRevision: revision,
  ...extra,
});

test("browser report cache reuses one Worker result across pages and sorting", async () => {
  let analyses = 0;
  const received: AnalyzeStrategicFitOptions[] = [];
  const cache = new StrategicFitReportCache(async (pgn, analysisOptions) => {
    analyses++;
    received.push(analysisOptions);
    return analyzeStrategicFit(GameTree.fromPgn(pgn), analysisOptions);
  });

  const first = await cache.getReport(PGN, options("browser:1", { page: { offset: 0, limit: 1 } }));
  const second = await cache.getReport(PGN, options("browser:1", {
    page: { offset: 2, limit: 2 },
    sort: "opening-scope",
  }));

  assert.equal(analyses, 1);
  assert.equal(first, second);
  assert.equal(received[0]?.page?.offset, 0);
  assert.equal(received[0]?.page?.limit, Number.MAX_SAFE_INTEGER);
  assert.equal(received[0]?.sort, "finding-id");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.findings), true);

  const page = projectStrategicFitReport(first, {
    kind: "page",
    expected_repertoire_revision: first.repertoire_revision,
    page: { limit: 1 },
  });
  assert.equal(page.projection, "page");
  if (page.projection !== "page") return;
  const finding = projectStrategicFitReport(first, {
    kind: "finding",
    expected_repertoire_revision: first.repertoire_revision,
    expected_report_id: first.report_id,
    finding_id: page.report.findings[0]!.finding_id,
  });
  assert.equal(finding.projection, "finding");
  assert.equal(analyses, 1, "paging and inspecting a finding do not rerun the Worker");
});

test("browser report cache misses on edits, reused revisions with changed content, color, and settings", async () => {
  let analyses = 0;
  const cache = new StrategicFitReportCache(async (pgn, analysisOptions) => {
    analyses++;
    return analyzeStrategicFit(GameTree.fromPgn(pgn), analysisOptions);
  }, 8);

  await cache.getReport(PGN, options("browser:1"));
  await cache.getReport(PGN, options("browser:2"));
  await cache.getReport(`${PGN}\n`, options("browser:2"));
  await cache.getReport(PGN, options("browser:2", { repertoireColor: "black" }));
  await cache.getReport(PGN, options("browser:2", { weighting: { mode: "manual" } }));
  assert.equal(analyses, 5);
});

test("browser report cache is bounded and removes rejected analyses", async () => {
  let analyses = 0;
  const cache = new StrategicFitReportCache(async (pgn, analysisOptions) => {
    analyses++;
    if (analysisOptions.repertoireRevision === "browser:reject") throw new Error("fixture failure");
    return analyzeStrategicFit(GameTree.fromPgn(pgn), analysisOptions);
  }, 2);

  await cache.getReport(PGN, options("browser:1"));
  await cache.getReport(PGN, options("browser:2"));
  await cache.getReport(PGN, options("browser:3"));
  assert.equal(cache.size, 2);
  await cache.getReport(PGN, options("browser:1"));
  assert.equal(analyses, 4, "the LRU-evicted report is recomputed");

  await assert.rejects(cache.getReport(PGN, options("browser:reject")), /fixture failure/);
  assert.equal(cache.size, 1, "the failed pending entry is removed without exceeding the bound");
});
