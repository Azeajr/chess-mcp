import { readFile, writeFile } from "node:fs/promises";
import { TOOL_CONTRACTS } from "../packages/chess-tools/dist/tool-contract.js";
import { WORKFLOW_CONTRACTS, renderWorkflowGuidance } from "../packages/chess-tools/dist/workflow-contract.js";

const root = new URL("../", import.meta.url);
const check = process.argv.includes("--check");
const begin = "<!-- BEGIN GENERATED WORKFLOW GUIDANCE -->";
const end = "<!-- END GENERATED WORKFLOW GUIDANCE -->";
const skills = {
  "analyze-position": "position",
  "chess-game-review": "review",
  "annotate-pgn": "annotation",
  "repertoire-builder": "repertoire",
};

let stale = false;
for (const [family, workflow] of Object.entries(WORKFLOW_CONTRACTS)) {
  for (const step of workflow.steps) {
    for (const host of ["browser", "mcp"]) {
      for (const name of step[`${host}Tools`]) {
        const contract = TOOL_CONTRACTS.find((candidate) => candidate.name === name);
        if (!contract?.hosts.includes(host)) throw new Error(`${family}/${step.title}: ${name} is not available on ${host}`);
      }
    }
  }
}
for (const [directory, family] of Object.entries(skills)) {
  const url = new URL(`.claude/skills/${directory}/SKILL.md`, root);
  const source = await readFile(url, "utf8");
  const generated = `${begin}\n${renderWorkflowGuidance(family, "mcp")}\n${end}`;
  const pattern = new RegExp(`${begin}[\\s\\S]*?${end}`);
  if (!pattern.test(source)) throw new Error(`${directory}: missing generated workflow markers`);
  const next = source.replace(pattern, generated);
  if (next === source) continue;
  stale = true;
  if (check) console.error(`${directory}: shared workflow guidance is stale (run pnpm sync:skills)`);
  else await writeFile(url, next, "utf8");
}
if (check && stale) process.exitCode = 1;
else console.log(check ? "workflow guidance: current" : "workflow guidance: synchronized");
