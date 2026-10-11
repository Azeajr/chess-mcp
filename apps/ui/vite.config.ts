import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";
import { webHarness } from "@azeajr/web-harness/vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Identifies the build in a diagnostic bundle: the released plugin version and the commit.
function appBuild() {
  let version = "unknown";
  let commit = "unknown";
  try {
    const manifest = new URL("../../plugin/.claude-plugin/plugin.json", import.meta.url);
    version = (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
  } catch {
    // An app-only checkout has no plugin manifest; the commit still identifies the build.
  }
  try {
    commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // Builds outside a git checkout, such as some containers, have no commit to report.
  }
  return { version, commit };
}

const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(appBuild()) },
  plugins: [
    solid(),
    crossOriginIsolation,
    // Dev-server identity for the agent harness (pnpm ux:review); serve-only, never in a build.
    webHarness(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "openings.tsv"],
      devOptions: { enabled: false },
      manifest: {
        name: "Chess Repertoire",
        short_name: "Repertoire",
        description: "Build and study chess opening repertoires.",
        theme_color: "#1e1e21",
        background_color: "#1e1e21",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,wasm}"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1_300 },
  optimizeDeps: { exclude: ["stockfish"] },
  worker: { format: "es" },
});
