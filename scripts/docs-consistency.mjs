import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contractsForHost, TOOL_CONTRACTS } from "../packages/chess-tools/dist/tool-contract.js";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);

async function markdownFiles(directory = rootUrl, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry.name)) return [];
      return [markdownFiles(new URL(`${entry.name}/`, directory), `${path}/`)];
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [[path]] : [];
  }));
  return nested.flat();
}

const files = await markdownFiles();
const currentFiles = files.filter((file) =>
  !file.startsWith("docs/archive/")
  && file !== "docs/TOOL_CATALOG.md"
);
const problems = [];
const semanticRules = [
  [/\b(?:get_current_line|get_document_summary|expand_capabilities)\b/, "removed browser command"],
  [/\b(?:automatic capability routing|capability bundles?|expand capabilities)\b/i, "superseded routed-tool design"],
  [/Anthropic SDK|shadcn-solid|Tailwind CSS/i, "superseded PWA stack claim"],
  [/full(?:y)? (?:or )?identical (?:PWA |browser )?(?:chat )?(?:tool )?parity/i, "unsupported parity claim"],
  [/\b\d+\s+(?:(?:canonical|MCP|browser(?:-chat)?|shared)\s+)?tools?\b/i, "hand-maintained tool count"],
];

for (const file of currentFiles) {
  const contents = await readFile(resolve(root, file), "utf8");
  for (const [pattern, reason] of semanticRules) if (pattern.test(contents)) problems.push(`${file}: ${reason}`);
}

const names = TOOL_CONTRACTS.map((contract) => contract.name);
if (new Set(names).size !== names.length) problems.push("canonical contract: duplicate operation name");
for (const host of ["mcp", "browser"]) {
  const contracts = contractsForHost(host);
  if (!contracts.length) problems.push(`canonical contract: empty ${host} inventory`);
  if (contracts.some((contract) => !contract.description.trim())) problems.push(`canonical contract: blank ${host} description`);
}

const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
for (const file of files) {
  const contents = await readFile(resolve(root, file), "utf8");
  for (const match of contents.matchAll(linkPattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(raw)) continue;
    const path = decodeURIComponent(raw.split("#", 1)[0]);
    const target = path.startsWith("/") ? resolve(root, `.${path}`) : resolve(dirname(resolve(root, file)), path);
    try { await stat(target); }
    catch { problems.push(`${file}: broken local link ${raw}`); }
  }
}

if (problems.length) {
  console.error([...new Set(problems)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`documentation consistency: ok (${TOOL_CONTRACTS.length} canonical; ${contractsForHost("mcp").length} MCP; ${contractsForHost("browser").length} browser)`);
}
