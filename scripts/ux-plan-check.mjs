import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  deriveTaskLifecycle,
  validateCompositeWidgetContract,
  validatePrimaryFiles,
  validateRelevantSymbol,
  validateWp000RequiredCommands,
} from "./lib/ux-task-contract.mjs";

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const readText = (file) => readFile(path.join(root, file), "utf8");
const manifest = await readJson("docs/ui-ux-remediation/manifest.json");
const state = await readJson("docs/ui-ux-remediation/state.json");
const packages = manifest.packages;
const foundations = manifest.foundations ?? {};
const errors = [];
const ids = Object.keys(packages);

for (const [id, item] of Object.entries(packages)) {
  for (const dependency of item.dependencies) {
    if (!packages[dependency]) errors.push(`${id}: unknown dependency ${dependency}`);
  }
  for (const gate of item.blockingGates) {
    if (!state.gates[gate]) errors.push(`${id}: unknown gate ${gate}`);
  }
  for (const foundation of item.prerequisites ?? []) {
    if (!foundations[foundation])
      errors.push(`${id}: unknown prerequisite foundation ${foundation}`);
    if (!state.foundations?.[foundation])
      errors.push(`${id}: missing prerequisite foundation state ${foundation}`);
  }
}

const visiting = new Set();
const visited = new Set();
const visit = (id, trail = []) => {
  if (visiting.has(id)) {
    errors.push(`cyclic dependency: ${[...trail, id].join(" → ")}`);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of packages[id].dependencies)
    if (packages[dependency]) visit(dependency, [...trail, id]);
  visiting.delete(id);
  visited.add(id);
};
for (const id of ids) visit(id);

const owners = new Map();
for (const [id, item] of Object.entries(packages)) {
  for (const finding of item.ownedAuditFindings)
    owners.set(finding, [...(owners.get(finding) ?? []), id]);
}
for (let number = 1; number <= 48; number += 1) {
  const finding = `UX-${String(number).padStart(3, "0")}`;
  if (!owners.has(finding)) errors.push(`unowned audit finding ${finding}`);
}

const criteria = new Set();
for (const [id, item] of Object.entries(packages)) {
  for (const criterion of item.acceptanceCriteria) {
    if (criteria.has(criterion.id))
      errors.push(`${id}: duplicate acceptance criterion ${criterion.id}`);
    criteria.add(criterion.id);
  }
  const packageState = state.packages[id];
  if (!packageState) errors.push(`${id}: missing state record`);
  if (!["not-started", "in-progress", "complete"].includes(packageState?.status))
    errors.push(`${id}: invalid lifecycle status ${packageState?.status ?? "missing"}`);
  for (const error of validatePrimaryFiles(item.primaryFiles))
    errors.push(`${id}: primary file ${error}`);
  for (const symbol of item.relevantSymbols) {
    const invalid = validateRelevantSymbol(symbol);
    if (invalid) errors.push(`${id}: relevant symbol ${symbol} ${invalid}`);
  }
  const lifecycle = deriveTaskLifecycle(item, packageState, state);
  if (packageState?.status === "complete" && lifecycle.readiness !== "not-executable")
    errors.push(`${id}: completed package is executable`);
  if (packageState?.status === "in-progress" && lifecycle.readiness !== "not-executable")
    errors.push(`${id}: in-progress package is executable`);
}

for (const command of validateWp000RequiredCommands(packages["WP-000"]))
  errors.push(`WP-000: required validation omits ${command}`);

const [plan, wp000, wp011, wp014] = await Promise.all([
  readText("docs/ui-ux-remediation-plan.md"),
  readText("docs/ui-ux-remediation/work-packages/WP-000.md"),
  readText("docs/ui-ux-remediation/work-packages/WP-011.md"),
  readText("docs/ui-ux-remediation/work-packages/WP-014.md"),
]);
for (const error of validateCompositeWidgetContract([
  packages["WP-000"].acceptanceCriteria.map((criterion) => criterion.text).join("\n"),
  packages["WP-011"].acceptanceCriteria.map((criterion) => criterion.text).join("\n"),
  packages["WP-014"].acceptanceCriteria.map((criterion) => criterion.text).join("\n"),
  plan,
  wp000,
  wp011,
  wp014,
]))
  errors.push(`composite-widget contract: ${error}`);

const driverPath = "apps/ui/.claude/skills/run-ui/driver.mjs";
if (!packages["WP-000"].primaryFiles.includes(driverPath))
  errors.push(`WP-000: missing canonical driver path ${driverPath}`);
for (const [name, text] of [
  ["plan", plan],
  ["WP-000 package", wp000],
]) {
  if (/(?:^|[^/])\.claude\/skills\/run-ui\/driver\.mjs/mu.test(text))
    errors.push(`${name}: driver path diverges from ${driverPath}`);
}

const pullRequests = manifest.pullRequests ?? [];
if (!pullRequests.length) {
  errors.push("missing structured pull-request accounting");
} else {
  const scheduled = pullRequests.flatMap((entry) => entry.packages);
  for (const id of ids) {
    if (scheduled.filter((candidate) => candidate === id).length !== 1)
      errors.push(`${id}: must appear exactly once in structured pull-request accounting`);
  }
  if (pullRequests.length !== 33)
    errors.push(`structured pull-request count is ${pullRequests.length}, expected 33`);
}

if (errors.length) {
  console.error(`UI/UX remediation plan check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `UI/UX remediation plan check passed: ${ids.length} packages, ${criteria.size} acceptance criteria, 48 findings.`,
  );
}
