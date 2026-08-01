import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const id = process.argv[2];
if (!id) throw new Error("Usage: pnpm ux:test WP-005");
const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "docs/ui-ux-remediation/manifest.json"), "utf8"));
const item = manifest.packages[id];
if (!item) throw new Error(`Unknown work package: ${id}`);
const missing = [];
for (const file of item.requiredTests.files) {
  const candidate = path.join(root, file);
  try {
    await access(candidate);
  } catch {
    missing.push(file);
  }
}
for (const file of missing) console.log(`MISSING: ${file}`);
for (const command of item.requiredTests.commands) {
  console.log(`RUN: ${command}`);
  const result = spawnSync(command, { cwd: root, shell: true, stdio: "inherit" });
  if (result.status !== 0) process.exitCode = result.status || 1;
}
if (!item.requiredTests.files.length && !item.requiredTests.commands.length) console.log("MISSING: no package-specific automated test is mapped yet.");
if (missing.length) process.exitCode = 1;
