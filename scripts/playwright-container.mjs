import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const updateSnapshots = args.includes("--update-snapshots");
const playwrightArgs = args.filter((arg) => arg !== "--update-snapshots");
const require = createRequire(path.join(root, "package.json"));
// `playwright` supplies the installed @playwright/test runner used by `pnpm exec playwright`.
const playwrightVersion = require("playwright/package.json").version;
const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "chess-mcp-playwright-"));
const workspace = path.join(temporaryRoot, "work");
const containerName = `chess-mcp-playwright-${process.pid}`;
let activeDocker;
let testStarted = false;
let interruptedBy;
let exitStatus = 0;

class DockerFailure extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function interruptionStatus() {
  return interruptedBy === "SIGINT" ? 130 : 143;
}

function assertNotInterrupted() {
  if (interruptedBy)
    throw new DockerFailure(
      `Playwright container validation interrupted by ${interruptedBy}.`,
      interruptionStatus(),
    );
}

function docker(args, message, { cleanup = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: root,
      stdio: cleanup ? "ignore" : "inherit",
    });
    activeDocker = child;
    child.on("error", (error) => {
      activeDocker = undefined;
      reject(
        new DockerFailure(
          `Docker is required for Playwright container validation: ${error.message}`,
          1,
        ),
      );
    });
    child.on("close", (status, signal) => {
      activeDocker = undefined;
      if (status === 0) resolve();
      else reject(new DockerFailure(message, status ?? (signal ? 1 : 1)));
    });
  });
}

function handleSignal(signal) {
  if (interruptedBy) return;
  interruptedBy = signal;
  activeDocker?.kill(signal);
}

process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));

function gitWorkingTreeFiles() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["ls-files", "--cached", "--modified", "--others", "--exclude-standard", "-z"],
      { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
    );
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0)
        return reject(new Error("Unable to enumerate the current Git working tree."));
      resolve(Buffer.concat(chunks).toString("utf8").split("\0").filter(Boolean));
    });
  });
}

async function copyWorkingTree() {
  const files = await gitWorkingTreeFiles();
  for (const relative of new Set(files)) {
    const source = path.resolve(root, relative);
    const destination = path.resolve(workspace, relative);
    if (
      !source.startsWith(`${root}${path.sep}`) ||
      !destination.startsWith(`${workspace}${path.sep}`)
    )
      throw new Error(`Refusing to copy a path outside the working tree: ${relative}`);
    try {
      await access(source);
    } catch {
      continue;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }
}

async function pngSnapshots(worktree) {
  const e2e = path.join(worktree, "apps/ui/test/e2e");
  const snapshots = new Set();
  for (const entry of await readdir(e2e, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".spec.ts-snapshots")) continue;
    for (const file of await readdir(path.join(e2e, entry.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith(".png"))
        snapshots.add(path.join(entry.name, file.name));
    }
  }
  return snapshots;
}

async function syncSnapshots() {
  const source = path.join(workspace, "apps/ui/test/e2e");
  const destination = path.join(root, "apps/ui/test/e2e");
  const [updated, existing] = await Promise.all([pngSnapshots(workspace), pngSnapshots(root)]);

  for (const relative of existing) {
    if (!updated.has(relative)) await rm(path.join(destination, relative), { force: true });
  }
  for (const relative of updated) {
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(source, relative), target, { force: true });
  }
}

async function copyReport() {
  const source = path.join(workspace, "apps/ui/playwright-report");
  try {
    await access(source);
  } catch {
    return;
  }
  const destination = path.join(root, "apps/ui/playwright-report");
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, force: true });
}

/**
 * The accessibility engine (apps/ui/test/accessibility) writes its evidence bundles under
 * apps/ui/test-results/accessibility inside the container's ephemeral workspace. Without this,
 * a container-run capture would pass and then discard the only copy of what it captured — the
 * container is deleted in `finally` below regardless of exit status.
 */
async function copyAccessibilityEvidence() {
  const source = path.join(workspace, "apps/ui/test-results/accessibility");
  try {
    await access(source);
  } catch {
    return;
  }
  const destination = path.join(root, "apps/ui/test-results/accessibility");
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

try {
  console.log(`Playwright ${playwrightVersion}; container image ${image}`);
  await docker(["pull", image], `Required Playwright image is unavailable: ${image}`);
  assertNotInterrupted();
  await copyWorkingTree();
  assertNotInterrupted();
  const command = [
    "set -eu",
    "mkdir -p /tmp/pnpm-bin",
    String.raw`printf '%s\n' '#!/bin/sh' 'exec corepack pnpm "$@"' > /tmp/pnpm-bin/pnpm`,
    "chmod +x /tmp/pnpm-bin/pnpm",
    "export PATH=/tmp/pnpm-bin:$PATH",
    "pnpm install --frozen-lockfile",
    "pnpm --filter @chess-mcp/chess-tools build",
    `pnpm exec playwright test --config apps/ui/playwright.config.ts --reporter=list,html${updateSnapshots ? " --update-snapshots" : ""} "$@"`,
  ].join("\n");
  testStarted = true;
  // Forward A11Y_*-prefixed env vars as a generic escape hatch — the accessibility engine's
  // capture.mjs uses A11Y_RUN_ID to give every parallel browser worker the same evidence
  // directory; without this, three workers in three processes each mint their own run ID and
  // the evidence can never be merged back into one report.
  const forwardedEnvArgs = Object.keys(process.env)
    .filter((name) => name.startsWith("A11Y_"))
    .flatMap((name) => ["-e", `${name}=${process.env[name]}`]);
  await docker(
    [
      "run",
      "--rm",
      "--init",
      "--ipc=host",
      "--name",
      containerName,
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "-e",
      "CI=1",
      "-e",
      "HOME=/tmp",
      ...forwardedEnvArgs,
      "-v",
      `${workspace}:/work`,
      "-w",
      "/work",
      image,
      "bash",
      "-lc",
      command,
      "playwright-container",
      ...playwrightArgs,
    ],
    "Playwright container validation failed.",
  );
  assertNotInterrupted();
  if (updateSnapshots) {
    await syncSnapshots();
    console.log("Updated PNG snapshots copied from the canonical container.");
  }
} catch (error) {
  if (!(error instanceof DockerFailure)) throw error;
  console.error(error.message);
  exitStatus = error.status;
} finally {
  if (testStarted) {
    try {
      await copyReport();
    } catch (error) {
      console.error(`Unable to copy Playwright report: ${error.message}`);
      exitStatus ||= 1;
    }
    try {
      await copyAccessibilityEvidence();
    } catch (error) {
      console.error(`Unable to copy accessibility evidence: ${error.message}`);
      exitStatus ||= 1;
    }
  }
  await docker(["rm", "--force", containerName], "Unable to remove Playwright container.", {
    cleanup: true,
  }).catch(() => {});
  await rm(temporaryRoot, { recursive: true, force: true });
  if (interruptedBy) exitStatus = interruptionStatus();
}

if (exitStatus) process.exitCode = exitStatus;
