// A stable group leader lets the controller validate PID/start time/command before stopping Vite.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const log = (event, detail = {}) => {
  const record = { at: new Date().toISOString(), event, pid: process.pid, ...detail };
  console.log(JSON.stringify(record));
  if (process.env.UX_REVIEW_EVENTS)
    appendFileSync(process.env.UX_REVIEW_EVENTS, JSON.stringify(record) + "\n");
};
log("server-start", { port: process.env.UX_REVIEW_PORT });

const child = spawn(
  "pnpm",
  [
    "--filter",
    "@chess-mcp/ui",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    process.env.UX_REVIEW_PORT ?? "4173",
    "--strictPort",
  ],
  { stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  log("server-error", { message: error.message });
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  log("server-exit", { childPid: child.pid, code, signal });
  process.exitCode = code ?? 1;
});
// The controller signals this owned process group, including pnpm and Vite.
process.on("SIGTERM", () => log("server-signal", { signal: "SIGTERM" }));
