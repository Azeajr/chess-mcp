import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildTaskCapsule } from "./lib/ux-task-contract.mjs";

const id = process.argv[2];
if (!id) throw new Error("Usage: pnpm ux:task WP-005");
const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "docs/ui-ux-remediation/manifest.json"), "utf8"),
);
const state = JSON.parse(
  await readFile(path.join(root, "docs/ui-ux-remediation/state.json"), "utf8"),
);
const item = manifest.packages[id];
if (!item) throw new Error(`Unknown work package: ${id}`);

const capsule = buildTaskCapsule(id, item, state);
if (!capsule.executable && state.packages[id]?.status === "complete") {
  console.error(capsule.text);
  process.exitCode = 1;
} else {
  console.log(capsule.text);
}
