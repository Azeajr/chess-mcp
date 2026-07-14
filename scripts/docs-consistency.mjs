import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function markdownFiles(directory = root, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry.name) || path === "docs/archive") return [];
      return [markdownFiles(new URL(`${entry.name}/`, directory), `${path}/`)];
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [[path]] : [];
  }));
  return nested.flat();
}
const files = await markdownFiles();
const currentFiles = files.filter((file) => file !== "PROJECT_REVIEW_PLAN.md");
const stale = [];
const rules = [
  [/\b(?:all |exactly |currently (?:has|registers) )?(?:30|34|38) tools\b/i, "stale hand-maintained tool count"],
  [/Anthropic SDK|shadcn-solid|Tailwind CSS/i, "superseded PWA stack claim"],
  [/full(?:y)? (?:or )?identical (?:PWA |browser )?(?:chat )?(?:tool )?parity/i, "unsupported parity claim"],
];
for (const file of currentFiles) {
  const text = await readFile(new URL(file, root), "utf8");
  for (const [pattern, reason] of rules) if (pattern.test(text)) stale.push(`${file}: ${reason}`);
}
if (stale.length) {
  console.error(stale.join("\n"));
  process.exitCode = 1;
} else {
  console.log("documentation consistency: ok");
}
