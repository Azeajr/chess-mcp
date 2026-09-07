// A stable group leader lets the controller validate PID/start time/command before stopping Vite.
import { spawn } from "node:child_process";

const child = spawn(
  "pnpm",
  ["--filter", "@chess-mcp/ui", "dev", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  { stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
// The controller signals this owned process group, including pnpm and Vite.
process.on("SIGTERM", () => {});
