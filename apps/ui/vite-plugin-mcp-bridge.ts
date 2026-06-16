/**
 * Dev-only UI↔MCP bridge (docs/design/UI_MCP_BRIDGE_DESIGN.md, §3).
 *
 * Spawns the stdio MCP server as a child and relays JSON-RPC between the browser and the child's
 * stdin/stdout. The browser POSTs one JSON-RPC message to the same-origin `/__mcp` endpoint —
 * same-origin so it passes the COEP:require-corp isolation the app runs under (C2). MCP stdio
 * framing is newline-delimited JSON. A request (has `id`) awaits the matching response; a
 * notification (no `id`) is forwarded and answered 204. One child per dev server, killed on close.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Plugin, ViteDevServer, Connect } from "vite";

// stdio: [pipe, pipe, inherit] → writable stdin, readable stdout, null stderr.
type McpChild = ChildProcessByStdio<Writable, Readable, null>;

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = resolve(HERE, "../mcp-server");
const CALL_TIMEOUT_MS = 120_000;

export function mcpBridge(): Plugin {
  let child: McpChild | null = null;
  const pending = new Map<number | string, (msg: unknown) => void>();
  let buf = "";

  function start(): void {
    if (child) return;
    // `node --import tsx` runs the TS entry directly; cwd is the package so its node_modules
    // (chess-tools workspace dep, tsx) resolve. One process → a clean kill on shutdown.
    const c: McpChild = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: MCP_DIR,
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });
    child = c;
    c.stdout.setEncoding("utf8");
    c.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number | string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // stray non-JSON line on stdout
        }
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      }
    });
    c.on("exit", () => {
      child = null;
    });
  }

  function stop(): void {
    if (child) {
      child.kill();
      child = null;
    }
  }

  const handle: Connect.NextHandleFunction = (req, res, next) => {
    if (req.method !== "POST") return next();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let msg: { id?: number | string };
      try {
        msg = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.end('{"error":"bad json"}');
        return;
      }
      start();
      if (!child) {
        res.statusCode = 503;
        res.end('{"error":"mcp unavailable"}');
        return;
      }
      if (msg.id == null) {
        child.stdin.write(JSON.stringify(msg) + "\n");
        res.statusCode = 204;
        res.end();
        return;
      }
      const id = msg.id;
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          res.statusCode = 504;
          res.end('{"jsonrpc":"2.0","error":{"code":-32000,"message":"mcp timeout"}}');
        }
      }, CALL_TIMEOUT_MS);
      pending.set(id, (response) => {
        clearTimeout(timer);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(response));
      });
      child.stdin.write(JSON.stringify(msg) + "\n");
    });
  };

  return {
    name: "mcp-bridge",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      start();
      server.middlewares.use("/__mcp", handle);
      server.httpServer?.on("close", stop);
      // Kill the child on normal exit and on the signals vite is usually terminated with, so a
      // restarted dev server doesn't leak an orphaned MCP process. (`exit` alone misses SIGTERM.)
      process.once("exit", stop);
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.once(sig, () => {
          stop();
          process.exit(0);
        });
      }
    },
  };
}
