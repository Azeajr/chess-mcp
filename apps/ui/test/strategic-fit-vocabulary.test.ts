import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  STRATEGIC_FIT_PROTECTED_STATEMENTS,
  STRATEGIC_FIT_VOCABULARY,
  strategicFitTradeoffStatus,
} from "../src/content/strategicFit";

const uiSource = path.resolve(import.meta.dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function userFacingLines(file: string): { line: number; text: string }[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const out: { line: number; text: string }[] = [];
  let inBlockComment = false;
  lines.forEach((raw, index) => {
    let text = raw;
    if (inBlockComment) {
      const end = text.indexOf("*/");
      if (end === -1) return;
      text = text.slice(end + 2);
      inBlockComment = false;
    }
    const blockStart = text.indexOf("/*");
    if (blockStart !== -1) {
      const end = text.indexOf("*/", blockStart);
      if (end === -1) {
        text = text.slice(0, blockStart);
        inBlockComment = true;
      } else {
        text = text.slice(0, blockStart) + text.slice(end + 2);
      }
    }
    const lineComment = text.indexOf("//");
    if (lineComment !== -1) text = text.slice(0, lineComment);
    if (text.trim() === "") return;
    out.push({ line: index + 1, text });
  });
  return out;
}

const MECHANICAL = [
  /data-[a-z-]*preflight/i,
  /data-[a-z-]*pareto/i,
  /\bpreflight[_.)\],}:=]/,
  /\bpareto[_.)\],}:=]/,
  /[A-Za-z]Preflight\b/,
  /\bPreflightIssue/,
  /\bPREFLIGHT_/,
  /Preflight(Results|Issue)/,
  /strategic-fit-preflight/,
  /replacement-pareto/,
  /[Rr]eplacementPareto/,
  /preflight[A-Z]/,
  /[a-z]Preflight[A-Z(]/,
  /pareto_status|pareto\.|active_pareto|dominated_by/,
  /import .*(Preflight|Pareto)/,
  /"preflight"|'preflight'/,
  /"pareto-optimal"|'pareto-optimal'/,
  /\.preflight\b/,
  /\bpreflight=\{/,
  /\bpreflight\s*(\?\?|!==|===)/,
  /\bconst preflight\b/,
];

const CONTRACT_VOCABULARY_FILES = ["llm/workflows.ts", "store/strategic-fit-portfolio.ts"];

function isMechanical(text: string): boolean {
  return MECHANICAL.some((pattern) => pattern.test(text));
}

function isContractVocabulary(file: string): boolean {
  const relative = path.relative(uiSource, file);
  return CONTRACT_VOCABULARY_FILES.some((entry) => relative.endsWith(entry));
}

describe("WP-034 retired primary labels", () => {
  const files = sourceFiles(uiSource);

  it("AC-1 does not use Pareto as a primary label", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (isContractVocabulary(file)) continue;
      for (const { line, text } of userFacingLines(file)) {
        if (!/pareto/i.test(text) || isMechanical(text)) continue;
        if (file.endsWith("content/strategicFit.ts") && /expert/i.test(text)) continue;
        offenders.push(`${path.relative(uiSource, file)}:${line} ${text.trim()}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("AC-2 does not use preflight as a primary label", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (isContractVocabulary(file)) continue;
      for (const { line, text } of userFacingLines(file)) {
        if (!/preflight/i.test(text) || isMechanical(text)) continue;
        offenders.push(`${path.relative(uiSource, file)}:${line} ${text.trim()}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("AC-3 does not use resolution proof or training exception as primary labels", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const { line, text } of userFacingLines(file)) {
        if (!/resolution proof|training exception|train the exception/i.test(text)) continue;
        if (/throw new Error\(/.test(text)) continue;
        offenders.push(`${path.relative(uiSource, file)}:${line} ${text.trim()}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("AC-1 pairs each tradeoff status with its expert term", () => {
    const optimal = strategicFitTradeoffStatus("pareto-optimal", []);
    assert.equal(optimal.plain, "No better option on every measure");
    assert.equal(optimal.expert, "Pareto-optimal");

    const beaten = strategicFitTradeoffStatus("dominated", ["cand-a", "cand-b"]);
    assert.equal(beaten.plain, "Beaten by cand-a, cand-b");
    assert.equal(beaten.expert, "Pareto-dominated");

    const unscored = strategicFitTradeoffStatus("unscored", []);
    assert.equal(unscored.plain, "Not enough evidence to compare");
  });
});

describe("WP-034 definitions and shared help text", () => {
  it("AC-4 defines strategic distance in prose", () => {
    const definition = STRATEGIC_FIT_VOCABULARY.strategicDistanceDefinition;
    assert.match(definition, /^Strategic distance is /);
    assert.match(definition, /differ from its comparison route/);
  });

  it("AC-4 marks every surface that mentions strategic distance with the definition", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(uiSource)) {
      const contents = readFileSync(file, "utf8");
      if (!/strategic distance/i.test(contents)) continue;
      if (file.endsWith("content/strategicFit.ts")) continue;
      if (!contents.includes("data-strategic-distance-definition")) {
        offenders.push(path.relative(uiSource, file));
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("AC-5 gives the four advanced preferences one definition and distinct effects", () => {
    const { definition, effects } = STRATEGIC_FIT_VOCABULARY.advancedPreferences;
    assert.match(definition, /These four preferences/);

    const values = Object.values(effects);
    assert.equal(values.length, 4);
    assert.equal(new Set(values).size, 4, "each field's help text is distinct");
    for (const value of values) {
      assert.ok(value.split(" ").length <= 2, `${value} is a two-word effect`);
    }
  });
});

describe("WP-034 protected propositions", () => {
  const files = sourceFiles(uiSource);
  const corpus = files.map((file) => readFileSync(file, "utf8"));
  const toolsSource = path.resolve(import.meta.dirname, "../../../packages/chess-tools/src");
  const toolsCorpus = sourceFiles(toolsSource).map((file) => readFileSync(file, "utf8"));

  it("AC-6 keeps all five canonical statements verbatim", () => {
    const everywhere = [...corpus, ...toolsCorpus];
    for (const [name, statement] of Object.entries(STRATEGIC_FIT_PROTECTED_STATEMENTS)) {
      assert.ok(
        everywhere.some((contents) => contents.includes(statement)),
        `${name} is still present verbatim: ${statement}`,
      );
    }
  });

  it("AC-6 keeps the profile wizard's structure intact", () => {
    const setup = readFileSync(
      path.join(uiSource, "components/strategic-fit/ProfileSetup.tsx"),
      "utf8",
    );
    assert.ok(setup.includes("Recommended"), "RECOMMENDED badge preserved");
    assert.ok(setup.includes("Skip for now"), "Skip for now preserved");
    assert.ok(
      setup.includes("The base scan is engine-free."),
      "engine consequence statement preserved",
    );
  });
});
