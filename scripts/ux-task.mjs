import { readFile } from "node:fs/promises";
import path from "node:path";

const id = process.argv[2];
if (!id) throw new Error("Usage: pnpm ux:task WP-005");
const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "docs/ui-ux-remediation/manifest.json"), "utf8"));
const state = JSON.parse(await readFile(path.join(root, "docs/ui-ux-remediation/state.json"), "utf8"));
const item = manifest.packages[id];
if (!item) throw new Error(`Unknown work package: ${id}`);
const status = (entry) => entry?.status ?? "missing";
const dependencies = [
  ...item.dependencies.map((dependency) => `${dependency}: ${status(state.packages[dependency])}`),
  ...(item.prerequisites ?? []).map((foundation) =>
    `${foundation} (foundation): ${status(state.foundations?.[foundation])}`,
  ),
];
const gates = item.blockingGates.map((gate) => `${gate}: ${status(state.gates[gate])}`);
const ready = dependencies.every((entry) => entry.endsWith(": completed")) && gates.every((entry) => entry.endsWith(": resolved"));
const section = (title, values) => `${title}:\n${values.length ? values.map((value) => `- ${value}`).join("\n") : "- none"}`;
console.log([
  `${id} — readiness: ${ready ? "ready" : "blocked"}`,
  section("dependency status", dependencies),
  section("gate status", gates),
  section("allowed primary files", item.primaryFiles),
  section("relevant symbols", item.relevantSymbols),
  section("acceptance criteria", item.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.text.replace(/^- /u, "")}`)),
  section("preserved behavior contracts", item.preservedBehaviorContracts ?? ["See the package capsule's Behaviors to preserve section."]),
  section("required tests", [...item.requiredTests.files, ...item.requiredTests.commands]),
  `rollback rule:\n- ${item.rollbackRule ?? "See the package capsule's Failure and rollback contract."}`,
].join("\n\n"));
