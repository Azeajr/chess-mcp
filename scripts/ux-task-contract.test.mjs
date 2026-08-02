import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildTaskCapsule,
  deriveTaskLifecycle,
  normalizePrimaryFile,
  validateCompositeWidgetContract,
  validatePrimaryFiles,
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
  assert.match(capsule.text, /do not execute it again/u);
  assert.doesNotMatch(capsule.text, /allowed primary files/u);
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
