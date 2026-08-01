import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
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
    if (!foundations[foundation]) errors.push(`${id}: unknown prerequisite foundation ${foundation}`);
    if (!state.foundations?.[foundation]) errors.push(`${id}: missing prerequisite foundation state ${foundation}`);
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
  for (const dependency of packages[id].dependencies) if (packages[dependency]) visit(dependency, [...trail, id]);
  visiting.delete(id);
  visited.add(id);
};
for (const id of ids) visit(id);

const owners = new Map();
for (const [id, item] of Object.entries(packages)) {
  for (const finding of item.ownedAuditFindings) owners.set(finding, [...(owners.get(finding) ?? []), id]);
}
for (let number = 1; number <= 48; number += 1) {
  const finding = `UX-${String(number).padStart(3, "0")}`;
  if (!owners.has(finding)) errors.push(`unowned audit finding ${finding}`);
}

const criteria = new Set();
for (const [id, item] of Object.entries(packages)) {
  for (const criterion of item.acceptanceCriteria) {
    if (criteria.has(criterion.id)) errors.push(`${id}: duplicate acceptance criterion ${criterion.id}`);
    criteria.add(criterion.id);
  }
  const packageState = state.packages[id];
  if (!packageState) errors.push(`${id}: missing state record`);
  if (packageState?.status === "ready") {
    for (const dependency of item.dependencies) {
      if (state.packages[dependency]?.status !== "completed") errors.push(`${id}: ready with unresolved dependency ${dependency}`);
    }
    for (const gate of item.blockingGates) {
      if (state.gates[gate]?.status !== "resolved") errors.push(`${id}: ready with unresolved gate ${gate}`);
    }
    for (const foundation of item.prerequisites ?? []) {
      if (state.foundations?.[foundation]?.status !== "completed") {
        errors.push(`${id}: ready with unresolved prerequisite foundation ${foundation}`);
      }
    }
  }
}

const pullRequests = manifest.pullRequests ?? [];
if (!pullRequests.length) {
  errors.push("missing structured pull-request accounting");
} else {
  const scheduled = pullRequests.flatMap((entry) => entry.packages);
  for (const id of ids) {
    if (scheduled.filter((candidate) => candidate === id).length !== 1) {
      errors.push(`${id}: must appear exactly once in structured pull-request accounting`);
    }
  }
  if (pullRequests.length !== 33) errors.push(`structured pull-request count is ${pullRequests.length}, expected 33`);
}

if (errors.length) {
  console.error(`UI/UX remediation plan check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`UI/UX remediation plan check passed: ${ids.length} packages, ${criteria.size} acceptance criteria, 48 findings.`);
}
