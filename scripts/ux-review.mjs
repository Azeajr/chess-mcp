import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  open,
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  realpath,
  appendFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  availablePort,
  acquirePortLease,
  releasePortLease,
  reviewUrl,
  serverIdentity,
  deviceFor,
  digest,
  failures,
  imageFor,
  ownsContainer,
  ownsProcess,
  parseArgs,
  processIdentity,
  resolvePath,
  resultJson,
  run,
  slug,
} from "./ux-review/core.mjs";
import { installPolicy, seedPage } from "./ux-review/browser.mjs";

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const require = createRequire(path.join(root, "package.json"));
const { devices } = require("playwright");
const version = require("playwright/package.json").version;
const cliEntry = path.join(root, "node_modules/playwright/cli.js");
const serverEntry = path.join(root, "scripts/ux-review/server.mjs");
const docker = (args, options = {}) => run("docker", args, { cwd: root, ...options });
// Separate worktrees can each own a session, so bound every container the browser runs in. The
// session's Vite server is spawned on the host by startServer and is outside this bound.
const containerMemory = process.env.UX_REVIEW_DOCKER_MEMORY ?? "3g";
const containerCpus = process.env.UX_REVIEW_DOCKER_CPUS ?? "2";
// The server runs on the host, outside the container bounds above, so cap its heap instead. This
// stays an argv entry, so the PID, start time, cwd and serverEntry that ownsProcess matches on are
// unchanged. It bounds the V8 heap only: esbuild and other child processes are not covered.
const serverHeapMb = process.env.UX_REVIEW_SERVER_HEAP_MB ?? "1024";
if (!/^[1-9]\d{1,4}$/.test(serverHeapMb))
  throw new Error("UX_REVIEW_SERVER_HEAP_MB must be a positive integer number of megabytes.");
let manifest;
let manifestPath;
let lockPath;
let creating = false;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
  });
const assertRunning = () => {
  if (interrupted) throw new Error("Review command interrupted.");
};

function help() {
  console.log(`Docker-based interactive UX review (Linux; local Playwright ${version}).
Usage: pnpm ux:review -- [--session NAME] <command> [options]
  preflight       Check Docker/image/device launch and port; never install packages or pull images
  start           Start owned Vite/container, seed, snapshot, screenshot, and check faults
  reset           Recreate the browser profile and replay the same seed in a new run directory
  screenshot LABEL [--full-page] [--hires]  Save a numbered PNG at a printed absolute host path
  check           Retain/write faults.json; exit 1 for runtime, engine, or network faults
  status          Print ownership, artifacts, and next commands
  stop            Close session and remove only owned container/server; retain review artifacts
  cli <args...>   Run arbitrary Playwright CLI commands inside the owned session

Start/preflight: --browser webkit --device "iPhone 13 Mini" --seed rich-repertoire
  --port PORT (default 4173; use distinct ports for concurrent sessions)
  --url URL (identity-verified external localhost server; never stopped) --route / --color white|black
  --pgn REPO_FILE --setup REPO_FILE (trusted async page => {...} returning JSON postconditions)
  --workflow SLUG --output DIRECTORY (default .ux-review; repeat for subsequent commands)
Every command accepts --help. Put controller options BEFORE cli; remaining arguments go to Playwright.
Reset refuses changed PGN/setup digests; use stop/start to establish a changed baseline.
No persistent browser profile, host WebKit installation, or silent browser fallback.
Exit 0: success; exit 1: invalid input, failed preflight, fault, ownership, or cleanup check.

Examples:
  pnpm ux:review -- preflight
  pnpm ux:review -- start --workflow strategic-fit
  pnpm ux:review -- cli snapshot --depth=6 --boxes
  pnpm ux:review -- cli click "getByRole('button', { name: 'Open Strategic Fit' })"
  pnpm ux:review -- screenshot workspace
  pnpm ux:review -- check
  pnpm ux:review -- reset
  pnpm ux:review -- stop
Guide: ${path.join(root, "docs/UX_REVIEW.md")}`);
}

async function save() {
  await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
  await rename(`${manifestPath}.tmp`, manifestPath);
}

async function event(kind, detail = {}) {
  await appendFile(
    path.join(path.dirname(manifestPath), "events.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), kind, runId: manifest.runId, ...detail }) + "\n",
  );
}

async function health({ browser = true } = {}) {
  try {
    if (!manifest.identity)
      throw new Error("Legacy session has no server identity. Stop/start to reseed.");
    if (manifest.status === "infrastructure-failed")
      throw new Error("Session lost server continuity. Stop/start to reseed.");
    if (
      manifest.server &&
      !ownsProcess(manifest.server, await processIdentity(manifest.server.pid), root, serverEntry)
    )
      throw new Error("Owned Vite server is no longer running. Stop/start to reseed.");
    await serverIdentity(manifest.seed.url, root, manifest.identity.token);
    if (browser) {
      const identity = await code(async (page) => ({
        token: await page
          .locator('meta[name="chess-ux-server"]')
          .getAttribute("content", { timeout: 2_000 }),
        url: page.url(),
      }));
      if (
        identity.token !== manifest.identity.token ||
        new URL(identity.url).origin !== new URL(manifest.seed.url).origin
      )
        throw new Error("Browser is attached to a different server. Stop/start to reseed.");
    }
  } catch (error) {
    manifest.status = "infrastructure-failed";
    manifest.infrastructureFaults ??= [];
    manifest.infrastructureFaults.push({
      at: new Date().toISOString(),
      kind: "infrastructure",
      detail: error.message,
    });
    await event("health-failed", { message: error.message });
    await save();
    throw error;
  }
}

async function inspectContainer() {
  const all = JSON.parse(
    await docker(["ps", "-a", "--no-trunc", "--format", "{{json .ID}}"]).then(
      (output) => `[${output.split("\n").filter(Boolean).join(",")}]`,
    ),
  );
  if (!all.includes(manifest.containerId)) return null;
  const info = JSON.parse(await docker(["inspect", manifest.containerId]))[0];
  if (!ownsContainer(manifest, info))
    throw new Error("Container ownership mismatch; refusing to use or remove it.");
  return info;
}

async function cli(args, { raw = false } = {}) {
  assertRunning();
  const info = await inspectContainer();
  if (!info?.State.Running)
    throw new Error("Owned review container is not running. Use stop, then start.");
  const output = await docker(
    [
      "exec",
      "-w",
      path.dirname(manifest.runDir),
      manifest.containerId,
      "node",
      cliEntry,
      "cli",
      `-s=${manifest.session}`,
      ...(raw ? ["--raw"] : []),
      ...args,
    ],
    { print: true, timeout: 180_000 },
  );
  // CLI tools may report an error while the transport itself exits successfully.
  if (/^### Error\b/m.test(output)) throw new Error(output);
  return raw ? resultJson(output) : output;
}

async function code(fn, arg) {
  const filename = path.join(manifest.runDir, `command-${randomUUID()}.js`);
  await writeFile(
    filename,
    `async page => (${fn.toString()})(page, ${JSON.stringify(arg ?? null)})`,
  );
  return cli(["run-code", `--filename=${filename}`], { raw: true });
}

async function seedData(options) {
  if ((options.seed ?? "rich-repertoire") !== "rich-repertoire")
    throw new Error(
      "Only --seed rich-repertoire is registered; use --pgn for an explicit fixture.",
    );
  const pgnPath = await resolvePath(
    root,
    options.pgn ?? "apps/ui/test/fixtures/ux-review/rich-repertoire.pgn",
  );
  const setupPath = options.setup ? await resolvePath(root, options.setup) : null;
  const pgn = await readFile(pgnPath, "utf8");
  const setup = setupPath ? await readFile(setupPath, "utf8") : null;
  const { GameTree } = await import(path.join(root, "packages/chess-tools/dist/index.js"));
  const tree = GameTree.fromPgn(pgn);
  if (!tree.stats().nodes) throw new Error("Seed PGN has no legal moves.");
  const color = options.color ?? "white";
  if (!["white", "black"].includes(color)) throw new Error("--color must be white or black.");
  const seed = {
    pgn,
    expectedPgn: tree.toPgn(),
    color,
    fileName: path.basename(pgnPath),
    pgnPath,
    setupPath,
    url: reviewUrl(options),
    setup,
  };
  return { ...seed, digest: digest(JSON.stringify(seed)) };
}

async function probeUrl(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  const html = await response.text();
  if (!response.ok || !html.includes("/src/index.tsx"))
    throw new Error(
      `No chess development app at ${url}. Production preview has no __chess harness.`,
    );
}

async function preflight(options, { checkPort = true } = {}) {
  if (process.platform !== "linux")
    throw new Error(
      "This controller requires Linux Docker host networking and /proc ownership checks.",
    );
  const browser = options.browser ?? "webkit";
  const device = options.device ?? "iPhone 13 Mini";
  const descriptor = deviceFor(devices, device, browser);
  await run("pnpm", ["--version"], { cwd: root, timeout: 15_000 });
  await docker(["info", "--format", "{{.ServerVersion}}"]);
  const image = imageFor(version);
  let imageId;
  try {
    imageId = await docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  } catch {
    throw new Error(
      `Matching Playwright image is unavailable. Provision it with: docker pull ${image}`,
    );
  }
  const probeName = `chess-ux-probe-${randomUUID()}`;
  try {
    await docker([
      "run",
      "--rm",
      "--init",
      "--memory",
      containerMemory,
      "--memory-swap",
      containerMemory,
      "--cpus",
      containerCpus,
      "--name",
      probeName,
      "--network",
      "host",
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "-e",
      "HOME=/tmp",
      "-v",
      `${root}:${root}:ro`,
      "-w",
      "/tmp",
      imageId,
      "node",
      "--input-type=module",
      "-e",
      `import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(path.join(root, "package.json"))});
      const pw=require('playwright'); const b=await pw[${JSON.stringify(browser)}].launch();
      try { const c=await b.newContext(pw.devices[${JSON.stringify(device)}]); await c.newPage(); } finally { await b.close(); }`,
    ]);
  } finally {
    // --rm normally removed it; inspect exact unique probe name before cleanup on timeout.
    const ids = await docker(["ps", "-aq", "--filter", `name=^/${probeName}$`]);
    if (ids) await docker(["rm", "--force", ids]);
  }
  if (checkPort) {
    if (options.url) {
      await probeUrl(reviewUrl(options));
      await serverIdentity(reviewUrl(options), root);
    } else await availablePort(reviewUrl(options));
  }
  console.log(
    JSON.stringify(
      { node: process.version, playwright: version, image, imageId, browser, device, descriptor },
      null,
      2,
    ),
  );
  return { image, imageId, browser, device, descriptor };
}

async function startServer() {
  const log = await open(path.join(manifest.runDir, "vite.log"), "a");
  const child = spawn(process.execPath, [`--max-old-space-size=${serverHeapMb}`, serverEntry], {
    cwd: root,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: {
      ...process.env,
      UX_REVIEW_PORT: new URL(manifest.seed.url).port,
      UX_REVIEW_TOKEN: manifest.token,
      UX_REVIEW_EVENTS: path.join(path.dirname(manifestPath), "events.jsonl"),
    },
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  await log.close();
  manifest.server = await processIdentity(child.pid);
  await save();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    assertRunning();
    if (!(await processIdentity(child.pid))) break;
    try {
      await probeUrl(manifest.seed.url);
      manifest.identity = await serverIdentity(manifest.seed.url, root, manifest.token);
      await event("server-ready", { server: manifest.server, identity: manifest.identity });
      await save();
      return;
    } catch {
      await delay(200);
    }
  }
  throw new Error(`Vite did not become ready. See ${path.join(manifest.runDir, "vite.log")}`);
}

async function newRun() {
  manifest.runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  manifest.runDir = await resolvePath(
    root,
    path.join(manifest.output, manifest.session, manifest.runId),
    { outside: true },
  );
  manifest.sequence = 0;
  await mkdir(manifest.runDir, { recursive: true });
  await writeFile(
    path.join(manifest.runDir, "review.md"),
    `# ${manifest.workflow}\n\nRun: ${manifest.runId}\nSeed: ${manifest.seed.digest}\n\nWorkflow is an artifact label, not an executed journey. See docs/UX_REVIEW.md for completion requirements.\n\n## Goal and terminal acceptance\nNot yet recorded.\n\n## Attempts and evidence\nList ALL attempts (including failures), run IDs, check timestamps, CLI errors, warnings, and missing artifacts. faults.json covers only its recorded time.\n\n## Observations\nRecord visible controls, scoped roles, before/after FEN or path, running AND terminal state, inspected PNGs, and document continuity. Distinguish prepared side from side to move.\n\n## Verdict and remaining coverage\nNot yet reviewed. Zero faults does not establish workflow completion or error-path coverage.\n`,
  );
  await save();
}

async function screenshot(label, options = {}) {
  slug(label, "screenshot label");
  const number = String(manifest.sequence++).padStart(2, "0");
  const target = path.join(
    manifest.runDir,
    `${number}-${label}${options["full-page"] ? "-full-page" : ""}.png`,
  );
  console.log(
    await cli([
      "screenshot",
      `--filename=${target}`,
      ...(options["full-page"] ? ["--full-page"] : []),
      ...(options.hires ? ["--hires"] : []),
    ]),
  );
  await save();
  console.log(`Inspect image: ${target}`);
}

async function check({ throwOnFault = true } = {}) {
  let collected;
  try {
    collected = await code((page) => ({
      records: page.context().__chessUxFaults,
      warnings: page.context().__chessUxWarnings ?? [],
    }));
  } catch (error) {
    collected = { records: [], warnings: [] };
    // Never overwrite retained browser evidence just because its container disappeared.
    try {
      collected = JSON.parse(await readFile(path.join(manifest.runDir, "faults.json"), "utf8"));
    } catch {
      /* no prior check */
    }
    collected.records.push({ kind: "infrastructure", detail: error.message });
  }
  const records = [...collected.records, ...(manifest.infrastructureFaults ?? [])];
  const faults = failures(records);
  const report = path.join(manifest.runDir, "faults.json");
  await writeFile(
    report,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        runId: manifest.runId,
        records,
        faults,
        warnings: collected.warnings ?? [],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${faults.length} fault(s), ${collected.warnings?.length ?? 0} warning(s): ${report}`,
  );
  if (faults.length && throwOnFault)
    throw new Error(faults.map((fault) => `${fault.kind}: ${fault.detail}`).join("\n"));
}

async function initialize() {
  // Open blank first: policy and cloud-eval setting precede every app request, including first boot.
  console.log(
    await cli([
      "open",
      "about:blank",
      `--browser=${manifest.browser}`,
      `--device=${manifest.device}`,
    ]),
  );
  await health({ browser: false });
  await code(installPolicy, {
    origin: new URL(manifest.seed.url).origin,
    identityUrl: new URL("/__ux-review/identity", manifest.seed.url).href,
    identity: manifest.identity,
  });
  manifest.postconditions = await code(seedPage, manifest.seed);
  if (manifest.postconditions.url !== manifest.seed.url)
    throw new Error("Seed route postcondition failed.");
  if (manifest.seed.setup)
    manifest.setupPostconditions = await cli(["run-code", manifest.seed.setup], { raw: true });
  await check(); // Seed faults must not disappear at the log boundary.
  await cli(["console", "--clear"]);
  await cli(["requests", "--clear"]);
  // Keep seed warnings and faults for the entire run, including after navigation.
  console.log(
    await cli([
      "snapshot",
      "--depth=6",
      "--boxes",
      `--filename=${path.join(manifest.runDir, "00-seeded.yml")}`,
    ]),
  );
  await screenshot("seeded", { hires: true });
  manifest.source = {
    commit: await run("git", ["rev-parse", "HEAD"], { cwd: root }),
    worktree: await run("git", ["status", "--short"], { cwd: root }),
  };
  manifest.status = "ready";
  await save();
  await writeFile(
    path.join(manifest.runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await check();
}

async function cleanup() {
  await event("stop-requested", { server: manifest.server });
  const errors = [];
  if (manifest.containerId) {
    try {
      const info = await inspectContainer();
      if (info) {
        if (info.State.Running && !interrupted) {
          await cli(["close"]).catch((error) => console.error(error.message));
          await cli(["delete-data"]).catch((error) => console.error(error.message));
        }
        await docker(["rm", "--force", manifest.containerId]);
      }
      manifest.containerId = null;
    } catch (error) {
      errors.push(error.message);
    }
  }
  // Do not release the server/port if the owned browser could not be closed.
  if (manifest.server && !errors.length) {
    try {
      const actual = await processIdentity(manifest.server.pid);
      if (actual) {
        if (!ownsProcess(manifest.server, actual, root, serverEntry))
          throw new Error("Vite process ownership mismatch; refusing to stop it.");
        process.kill(-actual.pid, "SIGTERM");
        const deadline = Date.now() + 5_000;
        while ((await processIdentity(actual.pid)) && Date.now() < deadline) await delay(100);
        const remaining = await processIdentity(actual.pid);
        if (remaining && ownsProcess(manifest.server, remaining, root, serverEntry))
          process.kill(-actual.pid, "SIGKILL");
      }
      manifest.server = null;
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (manifest.portLease && !errors.length) {
    try {
      await releasePortLease(manifest.portLease, manifest.token);
      manifest.portLease = null;
    } catch (error) {
      errors.push(error.message);
    }
  }
  manifest.status = errors.length ? "cleanup-failed" : "stopped";
  await save();
  await event("cleanup", { status: manifest.status, errors });
  if (errors.length) throw new Error(errors.join("\n"));
}

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2));
  if (command === "help" || options.help) return help();
  const session = slug(options.session ?? "chess-ux");
  const output = await resolvePath(root, options.output ?? ".ux-review", {
    outside: Boolean(options.output),
  });
  if (command === "preflight") return preflight(options);
  const directory = await resolvePath(root, path.join(output, session), { outside: true });
  await mkdir(directory, { recursive: true });
  manifestPath = path.join(directory, "session.json");
  const pendingLock = path.join(directory, "command.lock");
  const lock = await open(pendingLock, "wx").catch(() => {
    throw new Error(
      `Session command lock exists: ${pendingLock}. Check its recorded PID before removing a stale lock.`,
    );
  });
  lockPath = pendingLock;
  await lock.writeFile(JSON.stringify(await processIdentity(process.pid)));
  await lock.close();
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    manifest &&
    (manifest.root !== root ||
      manifest.session !== session ||
      manifest.output !== output ||
      manifest.schema !== 1)
  )
    throw new Error("Invalid session manifest ownership.");
  if (command === "start") {
    if (manifest && manifest.status !== "stopped")
      throw new Error("Session already exists. Use status, reset, or stop before start.");
    const seed = await seedData(options);
    const environment = await preflight(options);
    assertRunning();
    manifest = {
      schema: 1,
      root,
      session,
      output,
      token: randomUUID(),
      ...environment,
      seed,
      options,
      workflow: slug(options.workflow ?? "review", "workflow"),
      status: "starting",
      server: null,
      containerId: null,
    };
    creating = true;
    await newRun();
    if (!options.url) {
      manifest.portLease = await acquirePortLease(seed.url, {
        token: manifest.token,
        root,
        session,
        manifestPath,
      });
      await save();
      await startServer();
    } else {
      manifest.identity = await serverIdentity(seed.url, root);
      await save();
    }
    assertRunning();
    manifest.containerId = await docker([
      "create",
      "--init",
      "--network",
      "host",
      "--ipc=host",
      "--memory",
      containerMemory,
      // Equal swap disables swap for the container: Docker otherwise grants twice the memory bound.
      "--memory-swap",
      containerMemory,
      "--cpus",
      containerCpus,
      "--name",
      `chess-ux-${session}-${manifest.token.slice(0, 8)}`,
      "--label",
      `chess-mcp.ux.root=${root}`,
      "--label",
      `chess-mcp.ux.token=${manifest.token}`,
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "-e",
      "HOME=/tmp",
      "-v",
      `${root}:${root}:ro`,
      "-v",
      `${directory}:${directory}:rw`,
      "-w",
      directory,
      manifest.imageId,
      "sleep",
      "infinity",
    ]);
    await save();
    await docker(["start", manifest.containerId]);
    await initialize();
    creating = false;
    return;
  }
  if (!manifest) {
    if (["status", "stop"].includes(command)) {
      console.log(`No session ${session}. Next: pnpm ux:review -- start`);
      return;
    }
    throw new Error("No session manifest. Run start first.");
  }
  // A manipulated manifest may not redirect writes outside this session artifact directory.
  if (
    manifest.runDir !== path.join(directory, manifest.runId) ||
    !/^[\da-zA-Z-]+$/.test(manifest.runId)
  )
    throw new Error("Invalid run directory in manifest.");
  await resolvePath(root, manifest.runDir, { outside: true });
  if (command === "stop") {
    if (manifest.status !== "stopped") {
      await health().catch(() => {});
      await check({ throwOnFault: false });
    }
    return cleanup();
  }
  if (command === "status") {
    if (!["stopped", "infrastructure-failed", "cleanup-failed"].includes(manifest.status)) {
      await health({ browser: false }).catch(async () => check({ throwOnFault: false }));
    }
    console.log(
      JSON.stringify(
        {
          status: manifest.status,
          container: manifest.containerId
            ? ((await inspectContainer())?.State.Status ?? "missing")
            : "none",
          serverOwned: Boolean(manifest.server),
          serverAlive: manifest.server
            ? ownsProcess(
                manifest.server,
                await processIdentity(manifest.server.pid),
                root,
                serverEntry,
              )
            : null,
          runDir: manifest.runDir,
          seed: manifest.seed.digest,
          identity: manifest.identity,
          infrastructureFaults: manifest.infrastructureFaults ?? [],
        },
        null,
        2,
      ),
    );
    console.log("Next: pnpm ux:review -- cli snapshot | screenshot <label> | check | reset | stop");
    return;
  }
  try {
    await health();
  } catch (error) {
    await check({ throwOnFault: false });
    throw error;
  }
  await event("command", { command, args: positional });
  if (command === "reset") {
    const seed = await seedData(manifest.options);
    if (seed.digest !== manifest.seed.digest)
      throw new Error(
        "Seed/setup changed. Stop/start to establish a new baseline; reset requires the same digest.",
      );
    await check({ throwOnFault: false }); // Preserve the prior fault report before replaying a fix.
    await event("reset-requested");
    await cli(["close"]);
    await cli(["delete-data"]);
    await newRun();
    manifest.status = "resetting";
    await save();
    await initialize();
  } else if (command === "screenshot") await screenshot(positional[0] ?? "state", options);
  else if (command === "check") await check();
  else if (command === "cli") {
    if (!positional.length) throw new Error("cli requires a Playwright command. Try cli snapshot.");
    if (
      positional.some((arg) =>
        /^(?:-s(?:=|$)|--(?:session|persistent|profile|config)(?:=|$))/.test(arg),
      ) ||
      [
        "open",
        "attach",
        "close",
        "detach",
        "delete-data",
        "close-all",
        "kill-all",
        "install",
        "install-browser",
      ].includes(positional[0])
    ) {
      throw new Error(
        "Use controller start/reset/stop for session lifecycle; CLI cannot override its session or profile.",
      );
    }
    console.log(await cli(positional));
  }
  await health();
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  if (manifest?.runDir) await event("command-failed", { message: error.message });
  if (creating && manifest)
    await cleanup().catch((failure) => console.error(`Cleanup failed: ${failure.message}`));
  process.exitCode = 1;
} finally {
  if (lockPath) await unlink(lockPath);
}
