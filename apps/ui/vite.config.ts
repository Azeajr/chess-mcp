import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";

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
