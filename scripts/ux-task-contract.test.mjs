import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTaskCapsule,
  deriveTaskLifecycle,
  normalizePrimaryFile,
  validateCompositeWidgetContract,
  validatePrimaryFiles,
  validateRemediationAgentInstructions,
  validateRelevantSymbol,
  validateWp000RequiredCommands,
} from "./lib/ux-task-contract.mjs";

const item = {
  dependencies: ["WP-000"],
  blockingGates: [],
  primaryFiles: ["apps/ui/src/App.tsx"],
  relevantSymbols: [],
  acceptanceCriteria: [],
  requiredTests: { files: [], commands: [] },
};
const state = (status, dependencyStatus = "complete") => ({
  packages: { "WP-000": { status: dependencyStatus }, "WP-001": { status } },
  gates: {},
  foundations: {},
});
const contract = [
  "The board is one page-level Tab stop with internal keyboard traversal.",
  "The move tree is one page-level Tab stop with internal arrow-key traversal.",
  "Individual squares are not page-level Tab stops.",
  "Individual move items are not page-level Tab stops.",
  "keyboardReachable reports zero unreachable .rep-row controls.",
].join("\n");

test("completed packages derive not-executable and emit no actionable capsule", () => {
  assert.deepEqual(deriveTaskLifecycle(item, { status: "complete" }, state("complete")), {
    status: "complete",
    readiness: "not-executable",
    unresolvedDependencies: [],
    unresolvedGates: [],
    unresolvedFoundations: [],
  });
  const capsule = buildTaskCapsule("WP-001", item, state("complete"));
  assert.equal(capsule.executable, false);
  assert.match(capsule.text, /STOP: WP-001 is complete\/non-executable/u);
  assert.doesNotMatch(capsule.text, /allowed primary files/u);
  assert.doesNotMatch(capsule.text, /agent execution protocol/u);
});

test("ready and blocked packages remain distinct", () => {
  assert.equal(
    deriveTaskLifecycle(item, { status: "not-started" }, state("not-started")).readiness,
    "ready",
  );
  assert.equal(
    deriveTaskLifecycle(item, { status: "not-started" }, state("not-started", "not-started"))
      .readiness,
    "blocked",
  );
  assert.equal(
    deriveTaskLifecycle(item, { status: "in-progress" }, state("in-progress")).readiness,
    "not-executable",
  );
});

test("ready capsule emits a dynamic package-specific execution protocol", () => {
  const capsule = buildTaskCapsule("WP-123", item, {
    ...state("not-started"),
    packages: { "WP-000": { status: "complete" }, "WP-123": { status: "not-started" } },
  });
  assert.equal(capsule.executable, true);
  assert.match(capsule.text, /allowed primary files/u);
  assert.match(capsule.text, /agent execution protocol for WP-123/u);
  assert.match(capsule.text, /pnpm ux:test WP-123/u);
  assert.match(capsule.text, /pnpm ux:task WP-123/u);
  assert.match(capsule.text, /next executable package/u);
  assert.match(capsule.text, /Do not stage or commit/u);
  assert.doesNotMatch(capsule.text, /WP-002/u);
});

test("blocked capsule reports blockers and emits only a stop protocol", () => {
  const capsule = buildTaskCapsule("WP-001", item, state("not-started", "not-started"));
  assert.equal(capsule.executable, false);
  assert.match(capsule.text, /blockers:\n- dependency WP-000/u);
  assert.match(capsule.text, /STOP: WP-001 is blocked/u);
  assert.doesNotMatch(capsule.text, /allowed primary files/u);
  assert.doesNotMatch(capsule.text, /agent execution protocol/u);
});

test("in-progress capsule is non-executable and emits only a stop protocol", () => {
  const capsule = buildTaskCapsule("WP-001", item, state("in-progress"));
  assert.equal(capsule.executable, false);
  assert.match(capsule.text, /status: in-progress/u);
  assert.match(capsule.text, /STOP: WP-001 is in-progress\/non-executable/u);
  assert.doesNotMatch(capsule.text, /agent execution protocol/u);
});

test("ux:task exits nonzero for every non-executable lifecycle fixture", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "chess-mcp-ux-task-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, "docs/ui-ux-remediation");
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(
    path.join(dataDirectory, "manifest.json"),
    JSON.stringify({ packages: { "WP-001": item } }),
  );
  const taskScript = fileURLToPath(new URL("./ux-task.mjs", import.meta.url));

  for (const [status, dependencyStatus] of [
    ["complete", "complete"],
    ["in-progress", "complete"],
    ["not-started", "not-started"],
  ]) {
    await writeFile(
      path.join(dataDirectory, "state.json"),
      JSON.stringify(state(status, dependencyStatus)),
    );
    const result = spawnSync(process.execPath, [taskScript, "WP-001"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 1, `${status}: ${result.stdout}${result.stderr}`);
  }
});

test("primary files require canonical repository-relative POSIX paths", () => {
  assert.deepEqual(normalizePrimaryFile("apps/ui/src/App.tsx"), {
    value: "apps/ui/src/App.tsx",
  });
  for (const value of [
    "/tmp/App.tsx",
    "apps/ui/src/../App.tsx",
    "./apps/ui/src/App.tsx",
    "apps//ui/src/App.tsx",
    "apps\\ui\\src\\App.tsx",
    "App.tsx",
    "pnpm test",
    "FOO=bar pnpm test",
    "git status | tee out",
  ])
    assert.ok(normalizePrimaryFile(value).error, value);
});

test("normalized duplicates and malformed relevant symbols are rejected", () => {
  assert.match(
    validatePrimaryFiles(["apps/ui/src/App.tsx", "apps/ui/src/./App.tsx"]).join("\n"),
    /duplicate normalized primary file/u,
  );
  for (const value of [
    "apps/ui/src/App.tsx",
    "App.tsx:42",
    "apps/ui/src/components/",
    "pnpm test",
    "git",
    "node --test",
  ])
    assert.ok(validateRelevantSymbol(value), value);
  assert.equal(validateRelevantSymbol("keyboardReachable"), undefined);
  assert.equal(validateRelevantSymbol(".rep-row"), undefined);
});

test("missing WP-000 validation commands are rejected", () => {
  assert.deepEqual(
    validateWp000RequiredCommands({ requiredTests: { commands: ["pnpm test:e2e:container"] } }),
    ["pnpm --filter @chess-mcp/ui test:chat", "pnpm ux:plan-check"],
  );
});

test("empty symbols render the explicit empty marker", () => {
  const capsule = buildTaskCapsule("WP-001", item, state("not-started"));
  assert.match(capsule.text, /relevant symbols:\n- none explicitly named/u);
});

test("composite-widget contract rejects individual-square and individual-move Tab requirements", () => {
  assert.deepEqual(validateCompositeWidgetContract([contract]), []);
  assert.match(
    validateCompositeWidgetContract([
      contract,
      "Every board square must be reached by page-level Tab.",
    ]).join("\n"),
    /individual board squares/u,
  );
  assert.match(
    validateCompositeWidgetContract([
      contract,
      "Each move item is required in the page-level Tab order.",
    ]).join("\n"),
    /individual moves/u,
  );
});

test("WP-000 records the canonical driver path consistently", async () => {
  const [manifestText, packageText, planText] = await Promise.all([
    readFile("docs/ui-ux-remediation/manifest.json", "utf8"),
    readFile("docs/ui-ux-remediation/work-packages/WP-000.md", "utf8"),
    readFile("docs/ui-ux-remediation-plan.md", "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const driverPath = "apps/ui/.claude/skills/run-ui/driver.mjs";
  assert.ok(manifest.packages["WP-000"].primaryFiles.includes(driverPath));
  assert.match(packageText, new RegExp(driverPath, "u"));
  assert.match(planText, new RegExp(driverPath, "u"));
  assert.doesNotMatch(packageText, /(?:^|[^/])\.claude\/skills\/run-ui\/driver\.mjs/mu);
  assert.doesNotMatch(planText, /(?:^|[^/])\.claude\/skills\/run-ui\/driver\.mjs/mu);
});

test("repository instructions establish the generic remediation convention", async () => {
  const source = await readFile("AGENTS.md", "utf8");
  assert.deepEqual(validateRemediationAgentInstructions(source), []);
  assert.match(source, /only after all required validation\s+passes/iu);
  assert.match(source, /Do not stage or commit unless the user separately requests it/iu);
  assert.match(source, /actual command results/iu);
  assert.doesNotMatch(source, /WP-\d{3} AC-\d+/u);
});
