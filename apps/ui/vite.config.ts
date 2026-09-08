import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const reviewIdentity = {
  root: realpathSync(fileURLToPath(new URL("../..", import.meta.url))),
  token: process.env.UX_REVIEW_TOKEN || randomUUID(),
};
const reviewIdentityPlugin = {
  name: "review-server-identity",
  apply: "serve" as const,
  transformIndexHtml() {
    return [
      {
        tag: "meta",
        attrs: { name: "chess-ux-server", content: reviewIdentity.token },
        injectTo: "head" as const,
      },
    ];
  },
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use("/__ux-review/identity", (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(reviewIdentity));
    });
  },
};

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
  plugins: [
    solid(),
    crossOriginIsolation,
    reviewIdentityPlugin,
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
  server: { hmr: { path: `/chess-ux-${reviewIdentity.token}` } },
  optimizeDeps: { exclude: ["stockfish"] },
  worker: { format: "es" },
});
