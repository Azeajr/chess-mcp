import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_CONVERSATION_LIMITS,
  STRATEGIC_FIT_EXPLANATIONS,
  analyzeStrategicFit,
  completeStrategicFitReport,
  contractsForHost,
  strategicFitCompleteAnalysisOptions,
  type AnalyzeStrategicFitOptions,
  type StrategicFitConversationFinding,
  type StrategicFitConversationFindings,
  type StrategicFitConversationSummary,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";
import { streamChat } from "../src/llm/openrouter.ts";
import { executeBrowserCommand } from "../src/application/browser-commands/client.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import { workflowPrompt } from "../src/llm/workflows.ts";

const PGN = `
[Event "King pawn"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *

[Event "Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 *

[Event "Closed"]
[Result "*"]

1. e4 c5 2. Nc3 Nc6 3. g3 g6 *`;

const tree = GameTree.fromPgn(PGN);
const REVISION = 12;

const analyze = (pgn: string, options: AnalyzeStrategicFitOptions): StrategicFitReport =>
  completeStrategicFitReport(
    analyzeStrategicFit(GameTree.fromPgn(pgn), strategicFitCompleteAnalysisOptions(options)),
  );

const cachedReport = () =>
  analyze(PGN, {
    repertoireColor: "white",
    repertoireRevision: `browser:${REVISION}`,
  });

function dependencies(report: StrategicFitReport | null) {
  return {
    ...defaultBrowserCommandDependencies,
    currentTree: () => tree,
    currentPgn: () => PGN,
    currentColor: () => "white" as const,
    currentRevision: () => REVISION,
    openings: async () => new Map(),
    strategicFitReport: async (pgn: string, options: AnalyzeStrategicFitOptions) =>
      analyze(pgn, options),
    strategicFitReportById: (reportId: string) =>
      report && report.report_id === reportId ? report : null,
  };
}

/** Resolve one dotted citation path against a returned command result. */
function resolves(root: unknown, path: string): boolean {
  let current = root;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return false;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

test("browser guidance carries the explanation contract in both the preset and preset-free prompts", () => {
  for (const mode of ["", "repertoire"] as const) {
    const prompt = workflowPrompt(mode);
    assert.match(prompt, /Explanation and exploration contract/);
    for (const level of STRATEGIC_FIT_EXPLANATIONS.levels) {
      assert.equal(
        prompt.includes(level.instruction),
        true,
        `${mode || "auto"} carries ${level.id}`,
      );
    }
    for (const query of STRATEGIC_FIT_EXPLANATIONS.queries) {
      assert.equal(prompt.includes(query.question), true, `${mode || "auto"} carries ${query.id}`);
      assert.equal(
        prompt.includes(query.missing),
        true,
        `${mode || "auto"} keeps ${query.id} honest`,
      );
    }
    assert.match(prompt, /mean evidence was withheld from you/);
    assert.match(prompt, /Never present one as zero/);
    assert.match(prompt, /carry no legality, engine evaluation, coverage, or popularity evidence/);
    assert.match(prompt, /never selects a command by itself/);
    assert.match(
      prompt,
      /The workspace charts and panels the user is looking at were never given to you/,
    );
  }
});

test("every grounded question's retrieval runs against a cached report and returns its view", async () => {
  const report = cachedReport();
  const deps = dependencies(report);
  const findingId = report.findings[0]!.finding_id;
  const expected = {
    summary: "strategic-fit-summary",
    findings: "strategic-fit-findings",
    finding: "strategic-fit-finding",
  } as const;
  let executed = 0;
  for (const query of STRATEGIC_FIT_EXPLANATIONS.queries) {
    if (query.view === null) continue;
    const result = (await executeBrowserCommand(
      "get_strategic_fit_report",
      {
        report_id: report.report_id,
        view: query.view,
        ...(query.sort === undefined ? {} : { sort: query.sort }),
        ...(query.view === "finding" ? { finding_id: findingId } : {}),
      },
      {},
      deps,
    )) as { retrieval?: string; error?: string };
    assert.equal(result.error, undefined, `${query.id} must not fail: ${result.error ?? ""}`);
    assert.equal(result.retrieval, expected[query.view], `${query.id} returns its declared view`);
    for (const path of query.cite) {
      const container =
        result.retrieval === "strategic-fit-finding"
          ? (result as unknown as StrategicFitConversationFinding).finding
          : result;
      const rows =
        result.retrieval === "strategic-fit-findings"
          ? (result as unknown as StrategicFitConversationFindings).findings
          : [];
      assert.equal(
        resolves(container, path) || (rows.length > 0 && rows.every((row) => resolves(row, path))),
        true,
        `${query.id} cites ${path}, which the command did not return`,
      );
    }
    executed += 1;
  }
  assert.ok(executed >= 3, "the guidance's report-backed questions were all executed");
});

test("a fake model's retrieval reaches the command and returns exactly the fields the levels cite", async (t) => {
  const report = cachedReport();
  const findingId = report.findings[0]!.finding_id;
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: { location: { origin: "http://test" } },
    configurable: true,
  });
  const callArguments = JSON.stringify({
    report_id: report.report_id,
    view: "finding",
    finding_id: findingId,
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
                          id: "r1",
                          function: { name: "get_strategic_fit_report", arguments: callArguments },
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
  const call = stream.toolCalls[0]!;
  assert.equal(call.function.name, "get_strategic_fit_report");

  const pgnBefore = defaultBrowserCommandDependencies.currentPgn();
  const revisionBefore = defaultBrowserCommandDependencies.currentRevision();
  const result = (await executeBrowserCommand(
    call.function.name,
    JSON.parse(call.function.arguments) as Record<string, unknown>,
    {},
    {
      ...dependencies(report),
      stageEdit: () => assert.fail("retrieving a report must never stage a repertoire edit"),
      proposeLine: () => assert.fail("retrieving a report must never propose a line"),
    },
  )) as StrategicFitConversationFinding;
  assert.equal(result.retrieval, "strategic-fit-finding");
  assert.equal(result.report_id, report.report_id);
  assert.equal(result.finding.finding_id, findingId);
  for (const level of STRATEGIC_FIT_EXPLANATIONS.levels) {
    for (const path of level.cite) {
      assert.equal(resolves(result.finding, path), true, `${level.id} cannot cite ${path}`);
    }
  }
  assert.equal(defaultBrowserCommandDependencies.currentPgn(), pgnBefore);
  assert.equal(defaultBrowserCommandDependencies.currentRevision(), revisionBefore);
  assert.equal(JSON.stringify(result).includes(PGN.trim()), false, "no document artifact is cited");
});

test("missing and withheld evidence reaches the model as explicit nulls, states, and disclosures", async () => {
  const report = cachedReport();
  const selected = report.findings[0]!;
  const summary = (await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id },
    {},
    dependencies(report),
  )) as StrategicFitConversationSummary;
  const unavailable = summary.metrics.filter((metric) => metric.state !== "available");
  assert.ok(unavailable.length > 0, "this report genuinely lacks some metric evidence");
  for (const metric of unavailable) {
    assert.equal(metric.value === null || typeof metric.value === "number", true);
    assert.notEqual(metric.state, "available");
  }
  assert.equal(typeof summary.preflight.omitted_issue_count, "number");

  // A report whose evidence exceeds the transport bounds must arrive flagged, not silently short.
  const stretched: StrategicFitReport = {
    ...report,
    findings: [
      {
        ...selected,
        explanation: "x".repeat(STRATEGIC_FIT_CONVERSATION_LIMITS.text_characters + 50),
        references: {
          ...selected.references,
          source_san_paths: [Array.from({ length: 40 }, (_, index) => `move${index}`)],
        },
      },
    ],
  };
  const finding = (await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id, view: "finding", finding_id: selected.finding_id },
    {},
    dependencies(stretched),
  )) as StrategicFitConversationFinding;
  assert.equal(finding.finding.explanation.truncated, true);
  assert.equal(finding.finding.source_san_paths[0]!.truncated, true);
  assert.equal(
    finding.finding.source_san_paths[0]!.san.length,
    STRATEGIC_FIT_CONVERSATION_LIMITS.san_path_plies,
  );
  assert.equal(typeof finding.finding.evidence.omitted_dimension_count, "number");
  assert.equal(typeof finding.finding.objective_quality.state, "string");
});

test("an exploration question routes nothing client-side and still offers the complete schema", async (t) => {
  const canonicalBrowserSchemas = contractsForHost("browser").length;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const settings = await import("../src/store/settings.ts");
  const chat = await import("../src/store/chat.ts");
  settings.setApiKey("test-key");
  const requests: { tools: { function: { name: string } }[] }[] = [];
  const executed: string[] = [];
  chat.setChatTransportForTesting(async (options) => {
    requests.push({ tools: options.tools });
    return { content: "I need the report identity first.", toolCalls: [] };
  });
  chat.setChatToolExecutorForTesting(async (name) => {
    executed.push(name);
    return { command: name };
  });
  t.after(() => {
    chat.setChatTransportForTesting();
    chat.setChatToolExecutorForTesting();
    settings.setApiKey("");
    chat.clearChat();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  for (const query of STRATEGIC_FIT_EXPLANATIONS.queries) {
    chat.clearChat();
    await chat.send(query.question);
    const names = requests.at(-1)!.tools.map((tool) => tool.function.name);
    assert.equal(names.length, canonicalBrowserSchemas, `${query.id} offers every command`);
    assert.equal(new Set(names).size, canonicalBrowserSchemas);
    assert.equal(names.includes("get_strategic_fit_report"), true);
    for (const tool of query.tools) {
      assert.equal(names.includes(tool), true, `${query.id} can reach ${tool}`);
    }
  }
  assert.deepEqual(executed, [], "no phrase in a question selected a command by itself");
});
