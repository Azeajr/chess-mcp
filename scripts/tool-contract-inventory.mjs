import { readFile } from "node:fs/promises";
import { TOOL_CONTRACTS } from "../packages/chess-tools/dist/tool-contract.js";

const root = new URL("../", import.meta.url);
const [mcpSource, browserSource] = await Promise.all([
  readFile(new URL("apps/mcp-server/src/index.ts", root), "utf8"),
  readFile(new URL("apps/ui/src/llm/tools.ts", root), "utf8"),
]);
const names = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1]);
const actual = {
  mcp: new Set(names(mcpSource, /server\.tool\(\s*[\r\n ]*"([a-z_]+)"/g)),
  browser: browserSource.includes('contractsForHost("browser").map')
    ? new Set(TOOL_CONTRACTS.filter((tool) => tool.hosts.includes("browser")).map((tool) => tool.name))
    : new Set(),
};
let failed = false;
const mcpCanonicalDescriptions = names(mcpSource, /server\.tool\(\s*"([a-z_]+)"\s*,\s*toolContract\("\1"\)\.description/g);
if (mcpCanonicalDescriptions.length !== actual.mcp.size) {
  failed = true;
  console.error(`mcp: only ${mcpCanonicalDescriptions.length}/${actual.mcp.size} descriptions use the matching canonical contract`);
}
const missingInputs = TOOL_CONTRACTS.filter((tool) => !tool.input).map((tool) => tool.name);
if (missingInputs.length) {
  failed = true;
  console.error(`canonical tools without input definitions: ${missingInputs.join(", ")}`);
}
for (const host of ["mcp", "browser"]) {
  const expected = new Set(TOOL_CONTRACTS.filter((tool) => tool.hosts.includes(host)).map((tool) => tool.name));
  const missing = [...expected].filter((name) => !actual[host].has(name));
  const extra = [...actual[host]].filter((name) => !expected.has(name));
  console.log(`${host}: ${actual[host].size} tools`);
  if (missing.length || extra.length) {
    failed = true;
    if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
    if (extra.length) console.error(`  unclassified: ${extra.join(", ")}`);
  }
}
if (failed) process.exitCode = 1;
else console.log("tool contract inventory: ok");
