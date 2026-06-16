import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

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
  plugins: [solid(), crossOriginIsolation],
  // stockfish ships its own worker/wasm; let it be served as-is, not pre-bundled.
  optimizeDeps: { exclude: ["stockfish"] },
  worker: { format: "es" },
});
