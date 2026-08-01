/**
 * Task 12.5 regression guard: no production source may reintroduce the removed Congruence V1
 * analyzer, the one-move `suggest_replacement_line` pivot, or the temporary `analyze_repertoire_congruence`
 * legacy projection. Scans only production source trees; tests and docs are out of scope here.
 */
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const productionRoots = ["packages/chess-tools/src/", "apps/mcp-server/src/", "apps/ui/src/"];
const bannedPatterns = [
  /\brepcongruence\b/,
  /strategic-fit\/legacy-projection\b/,
  /\banalyzeCongruence\b/,
  /\breplacementPivot\b/,
  /\bLEGACY_CONGRUENCE_[A-Z_]+\b/,
  /\bLegacyCongruence[A-Za-z]*\b/,
  /\bprojectStrategicFitLegacyResult\b/,
  /\boutlier_variation_path\b/,
  /\bsuggestReplacementLine\b/,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.flatMap((entry) => {
      if (entry.isDirectory()) return [sourceFiles(new URL(`${entry.name}/`, directory))];
      return entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name)
        ? [[new URL(entry.name, directory)]]
        : [];
    }),
  );
  return nested.flat();
}

let failed = false;
for (const relativeRoot of productionRoots) {
  const files = await sourceFiles(new URL(relativeRoot, root));
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const pattern of bannedPatterns) {
      if (pattern.test(content)) {
        failed = true;
        console.error(
          `${file.pathname.replace(root.pathname, "")}: matches removed legacy symbol ${pattern}`,
        );
      }
    }
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    "legacy import inventory: ok — no production consumer imports legacy congruence or pivot behavior",
  );
