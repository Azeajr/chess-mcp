import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";

// Cross-origin isolation (COOP/COEP) is required for SharedArrayBuffer, which threaded
// stockfish.js WASM needs. Set from day one (UI_DESIGN.md "Browser Constraints"). If a
// cross-origin asset later breaks under COEP:require-corp, fall back to single-threaded
// stockfish.js rather than dropping these headers.
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
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      // SW only in the production build (dev keeps HMR + the COOP/COEP middleware simple).
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
        // Precache the app shell + the single-threaded Stockfish wasm (~7MB) for offline use.
        globPatterns: ["**/*.{js,css,html,svg,wasm}"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  // Default bind is localhost. For LAN access run `pnpm dev:host` (vite --host).
  // stockfish ships its own worker/wasm; let it be served as-is, not pre-bundled.
  optimizeDeps: { exclude: ["stockfish"] },
  worker: { format: "es" },
});
