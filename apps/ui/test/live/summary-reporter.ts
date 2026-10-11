import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "playwright/types/testReporter";

// Pass rates per model and journey for the live journeys (docs/LIVE_CHAT_TESTS.md). Owns the exit
// status: a safety breach always fails the run; a journey the model could not finish only does when
// LIVE_MIN_PASS_RATE says so; infrastructure failures are reported apart so a moved or exhausted
// backend never reads as a model result.

type Kind = "passed" | "model" | "safety" | "infrastructure" | "skipped";
type Row = {
  model: string;
  journey: string;
  runs: Kind[];
  rounds: number[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  durationMs: number[];
  failures: string[];
};

const minPassRate = Number(process.env.LIVE_MIN_PASS_RATE ?? 0) || 0;

function classify(result: TestResult): Kind {
  if (result.status === "skipped") return "skipped";
  if (result.status === "passed") return "passed";
  const types = result.annotations.map((annotation) => annotation.type);
  if (types.includes("safety-breach")) return "safety";
  if (types.includes("infrastructure") || types.includes("bridge-error")) return "infrastructure";
  return "model";
}

export default class LiveSummaryReporter implements Reporter {
  private rows = new Map<string, Row>();
  private outputFile = "";

  onBegin(config: FullConfig) {
    this.outputFile = join(
      dirname(config.configFile ?? process.cwd()),
      "test-results/live-chat/summary.json",
    );
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const model = test.parent.project()?.name ?? "";
    const key = `${model}\u0000${test.title}`;
    const row: Row = this.rows.get(key) ?? {
      model,
      journey: test.title,
      runs: [],
      rounds: [],
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      durationMs: [],
      failures: [],
    };
    const kind = classify(result);
    row.runs.push(kind);
    row.durationMs.push(result.duration);
    if (kind !== "passed" && kind !== "skipped") {
      const named = (type: string) =>
        result.annotations
          .filter((annotation) => annotation.type === type)
          .map((annotation) => annotation.description);
      const breaches = named("safety-breach");
      const misses = named("outcome-miss");
      const firstError =
        (result.error?.message ?? "")
          // eslint-disable-next-line no-control-regex -- Playwright colours its messages
          .replace(/\u001b\[[0-9;]*m/g, "")
          .split("\n")[0]
          ?.slice(0, 240) ?? "";
      row.failures.push(
        breaches.length
          ? `safety: ${breaches.join("; ")}`
          : misses.length
            ? `missed: ${misses.join("; ")}`
            : `${kind}: ${firstError}`,
      );
    }
    const attachment = result.attachments.find((item) => item.name === "transcript.json");
    const transcript =
      attachment?.body ?? (attachment?.path ? readFileSync(attachment.path) : undefined);
    if (transcript) {
      const { rounds } = JSON.parse(transcript.toString()) as {
        rounds: { usage?: { input: number; cachedInput: number; output: number } }[];
      };
      row.rounds.push(rounds.length);
      for (const round of rounds) {
        row.inputTokens += round.usage?.input ?? 0;
        row.cachedInputTokens += round.usage?.cachedInput ?? 0;
        row.outputTokens += round.usage?.output ?? 0;
      }
    }
    this.rows.set(key, row);
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    const rows = [...this.rows.values()];
    if (!rows.length) return undefined;
    const count = (row: Row, kind: Kind) => row.runs.filter((run) => run === kind).length;
    const measured = (row: Row) =>
      count(row, "passed") + count(row, "model") + count(row, "safety");
    const average = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const k = (tokens: number) =>
      tokens < 10_000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens / 1000)}k`;

    const lines = ["", "Live chat journeys"];
    for (const model of new Set(rows.map((row) => row.model))) {
      lines.push("", `  ${model}`);
      for (const row of rows.filter((item) => item.model === model)) {
        const infra = count(row, "infrastructure");
        lines.push(
          `    ${count(row, "passed")}/${measured(row)} passed` +
            `${count(row, "safety") ? `  ${count(row, "safety")} SAFETY BREACH` : ""}` +
            `${infra ? `  ${infra} infrastructure` : ""}` +
            `  · ${average(row.rounds).toFixed(1)} rounds · ${Math.round(average(row.durationMs) / 1000)}s` +
            ` · ${k(row.inputTokens)} in (${k(row.cachedInputTokens)} cached) / ${k(row.outputTokens)} out` +
            `  ${row.journey}`,
        );
        for (const failure of row.failures) lines.push(`        ${failure}`);
      }
    }

    const reasons: string[] = [];
    for (const row of rows) {
      const label = `${row.model} · ${row.journey}`;
      if (count(row, "safety")) reasons.push(`safety breach in ${label}`);
      if (count(row, "skipped") === row.runs.length) continue;
      if (!measured(row)) reasons.push(`no measured run of ${label} (infrastructure only)`);
      else if (count(row, "passed") / measured(row) < minPassRate)
        reasons.push(`${label} passed below LIVE_MIN_PASS_RATE=${minPassRate}`);
    }
    lines.push(
      "",
      reasons.length
        ? `  FAILED: ${reasons.join("; ")}`
        : "  OK: no safety breach" +
            (minPassRate
              ? `, every journey at or above ${minPassRate}`
              : " (pass rates are reported, not gated)"),
      `  Transcripts: test-results/live-chat/runs · summary: ${this.outputFile}`,
      "",
    );
    console.log(lines.join("\n"));

    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(
      this.outputFile,
      JSON.stringify(
        {
          finishedAt: new Date().toISOString(),
          minPassRate,
          status: reasons.length ? "failed" : "passed",
          reasons,
          rows,
        },
        null,
        2,
      ),
    );
    if (result.status === "interrupted") return undefined;
    return { status: reasons.length ? "failed" : "passed" };
  }
}
