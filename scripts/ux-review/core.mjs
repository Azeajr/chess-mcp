import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const DEFAULT_URL = "http://127.0.0.1:4173";
export const commands = [
  "preflight",
  "start",
  "reset",
  "screenshot",
  "check",
  "status",
  "stop",
  "cli",
];
const valueOptions = new Set([
  "session",
  "browser",
  "device",
  "url",
  "route",
  "seed",
  "pgn",
  "color",
  "setup",
  "workflow",
  "output",
]);
const flagOptions = new Set(["help", "full-page", "hires"]);

export function slug(value, label = "session") {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(value))
    throw new Error(`Invalid ${label}: use 1–48 lowercase letters, digits, or hyphens.`);
  return value;
}

export function parseArgs(input) {
  const args = [...input];
  if (args[0] === "--") args.shift();
  const options = {};
  const positional = [];
  let command;
  while (args.length) {
    const arg = args.shift();
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      if (flagOptions.has(key)) {
        if (rest.length) throw new Error(`--${key} does not take a value.`);
        options[key] = true;
      } else if (valueOptions.has(key)) {
        const value = rest.length ? rest.join("=") : args.shift();
        if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
        options[key] = value;
      } else throw new Error(`Unknown option: --${key}`);
    } else if (!command) {
      command = arg;
      if (!commands.includes(command)) throw new Error(`Unknown command: ${command}`);
      if (command === "cli") return { command, options, positional: args };
    } else positional.push(arg);
  }
  if (positional.length > (command === "screenshot" ? 1 : 0))
    throw new Error("Unexpected positional arguments.");
  return { command: command ?? "help", options, positional };
}

export function contained(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

// Resolve existing ancestors as well as lexical paths, including a not-yet-created output directory.
export async function resolvePath(root, value, { outside = false } = {}) {
  const target = path.resolve(root, value);
  let ancestor = target;
  const missing = [];
  for (;;) {
    try {
      const resolved = path.join(await realpath(ancestor), ...missing.reverse());
      if (resolved !== target) throw new Error(`Symlink paths are not supported: ${value}`);
      if (!outside && !contained(root, resolved))
        throw new Error(`Path must be inside the repository: ${value}`);
      if (resolved === root || resolved === path.parse(resolved).root)
        throw new Error("Output must be a dedicated subdirectory.");
      return resolved;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}

export function targetUrl(value = DEFAULT_URL, route = "/") {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "--url must be a credential-free localhost or 127.0.0.1 HTTP(S) development server.",
    );
  }
  if (!route.startsWith("/") || route.startsWith("//"))
    throw new Error("--route must be a same-origin path starting with /.");
  const result = new URL(route, url);
  if (result.origin !== url.origin) throw new Error("--route must stay on the app origin.");
  return result.href;
}

export function deviceFor(devices, name, browser) {
  const descriptor = devices[name];
  if (!descriptor) throw new Error(`Unknown Playwright device: ${name}`);
  if (
    !["webkit", "chromium", "firefox"].includes(browser) ||
    descriptor.defaultBrowserType !== browser
  ) {
    throw new Error(
      `Device ${name} requires ${descriptor.defaultBrowserType}; choose a compatible --browser and --device explicitly.`,
    );
  }
  return descriptor;
}

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const imageFor = (version) => `mcr.microsoft.com/playwright:v${version}-noble`;

export function run(
  command,
  args,
  { cwd, timeout = 60_000, print = false, env = process.env } = {},
) {
  if (print) console.log([command, ...args.map((arg) => JSON.stringify(arg))].join(" "));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || timedOut)
        reject(
          new Error(
            `${command} ${args[0] ?? ""} ${timedOut ? "timed out" : `failed (${code})`}:\n${stderr || stdout}`,
          ),
        );
      else resolve(stdout.trim());
    });
  });
}

export function availablePort(url) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${target.port} is occupied or unavailable. Use --url only for a known development server, or stop its owner.`,
        ),
      ),
    );
    server.listen(Number(target.port), target.hostname, () => server.close(resolve));
  });
}

export async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid process PID.");
  try {
    const [stat, cmdline, cwd] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/cmdline`, "utf8"),
      realpath(`/proc/${pid}/cwd`),
    ]);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z") return null;
    return { pid, startTicks: fields[19], cmdline, cwd };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code)) return null;
    throw error;
  }
}

export function ownsProcess(record, actual, root, entry) {
  return Boolean(
    record &&
    actual &&
    record.pid === actual.pid &&
    record.startTicks === actual.startTicks &&
    actual.cwd === root &&
    actual.cmdline.split("\0").includes(entry),
  );
}

export function ownsContainer(manifest, info) {
  return Boolean(
    info &&
    info.Id === manifest.containerId &&
    info.Image === manifest.imageId &&
    info.Config?.Labels?.["chess-mcp.ux.root"] === manifest.root &&
    info.Config?.Labels?.["chess-mcp.ux.token"] === manifest.token,
  );
}

export function failures(records) {
  if (!Array.isArray(records)) throw new Error("Fault collector is missing. Reset the session.");
  return records.filter(
    (record) =>
      !(
        ["pageerror", "console.error"].includes(record.kind) &&
        /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(
          record.detail,
        )
      ),
  );
}

export function resultJson(output) {
  // --raw returns the run-code result directly; never accept prose as a successful postcondition.
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Playwright returned invalid structured output: ${output.slice(0, 500)}`);
  }
}
