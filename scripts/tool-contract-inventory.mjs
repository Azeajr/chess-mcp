import { readFile } from "node:fs/promises";
import { TOOL_CONTRACTS, jsonSchemaForTool } from "../packages/chess-tools/dist/tool-contract.js";
import { browserCommandImplementations, browserCommandRegistrations } from "../apps/ui/src/application/browser-commands/registry.ts";
import { toolSchemas } from "../apps/ui/src/llm/tools.ts";
import { schemaSemanticDifferences } from "./lib/schema-semantics.mjs";

const root = new URL("../", import.meta.url);
const mcpSource = await readFile(new URL("apps/mcp-server/src/index.ts", root), "utf8");
const names = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1]);
const registrations = {
  mcp: names(mcpSource, /server\.tool\(\s*[\r\n ]*"([a-z_]+)"/g),
  browser: browserCommandRegistrations.map(([name]) => name),
};
const actual = { mcp: new Set(registrations.mcp), browser: new Set(Object.keys(browserCommandImplementations)) };
let failed = false;
for (const host of ["mcp", "browser"]) {
  const duplicate = [...new Set(registrations[host].filter((name, index, all) => all.indexOf(name) !== index))];
  if (duplicate.length) {
    failed = true;
    console.error(`${host}: duplicate registrations: ${duplicate.join(", ")}`);
  }
}
const unregisteredBrowserKeys = Object.keys(browserCommandImplementations).filter((name) => !registrations.browser.includes(name));
if (unregisteredBrowserKeys.length) {
  failed = true;
  console.error(`browser: implementation keys without source registration: ${unregisteredBrowserKeys.join(", ")}`);
}
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

const transmittedNames = toolSchemas.map((schema) => schema.function.name);
if (new Set(transmittedNames).size !== transmittedNames.length) {
  failed = true;
  console.error("browser: duplicate transmitted schemas");
}
const browserExpected = TOOL_CONTRACTS.filter((tool) => tool.hosts.includes("browser"));
for (const contract of browserExpected) {
  const transmitted = toolSchemas.find((schema) => schema.function.name === contract.name);
  if (!transmitted) {
    failed = true;
    console.error(`browser: schema not transmitted: ${contract.name}`);
    continue;
  }
  const differences = schemaSemanticDifferences(transmitted.function.parameters, jsonSchemaForTool(contract.name, "browser"));
  if (differences.length) {
    failed = true;
    console.error(`browser schema drift: ${contract.name}: ${differences.join("; ")}`);
  }
}
const extraTransmitted = transmittedNames.filter((name) => !browserExpected.some((contract) => contract.name === name));
if (extraTransmitted.length) {
  failed = true;
  console.error(`browser: host-invalid transmitted schemas: ${extraTransmitted.join(", ")}`);
}
if (failed) process.exitCode = 1;
else console.log("tool contract inventory: ok");
