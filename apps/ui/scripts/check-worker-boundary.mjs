import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";

const assets = new URL("../dist/assets/", import.meta.url);
const files = (await readdir(assets)).filter((name) => name.endsWith(".js"));
const mainThreadFiles = files.filter((name) => !name.startsWith("strategic-fit.worker-"));
const analyzerMarker = "strategic_fit_analyze_missing_repertoire_revision";
const offenders = [];

for (const name of mainThreadFiles) {
  const source = await readFile(new URL(name, assets), "utf8");
  if (source.includes(analyzerMarker)) offenders.push(name);
}

if (offenders.length > 0) {
  throw new Error(
    `Strategic Fit analyzer leaked into browser main-thread assets: ${offenders.join(", ")}`,
  );
}

const indexSizes = [];
for (const name of files.filter((candidate) => /^index-.*\.js$/.test(candidate))) {
  const source = await readFile(new URL(name, assets));
  indexSizes.push(`${name} ${source.byteLength} bytes / ${gzipSync(source).byteLength} gzip`);
}

console.log(
  `[worker-boundary] analyzer marker absent from ${mainThreadFiles.length} main-thread JS asset(s)` +
    (indexSizes.length > 0 ? `; ${indexSizes.join("; ")}` : ""),
);
