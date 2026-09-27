/* global window, indexedDB */
// Agent harness adapter (https://github.com/Azeajr/web-harness). What the shared controller,
// Playwright fixture, production smoke and CI need to know about THIS app. Functions marked
// SERIALIZED are shipped as source text into the browser tooling: they may not close over
// anything in this file. `pnpm ux:review` and `pnpm harness` both run the controller; the
// workflow guide is docs/UX_REVIEW.md.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineHarness } from "@azeajr/web-harness/config";

const DEFAULT_PGN = "apps/ui/test/fixtures/ux-review/rich-repertoire.pgn";

// SERIALIZED. The board is the app shell; on a dev server the Strategic Fit metadata must also have
// loaded, or a seeded document races its own analysis inputs. Production has no __chess.
const ready = async (page) => {
  await page.locator(".board-wrap").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => !window.__chess || window.__chess.strategicFitMetadataStatus() === "ready",
    null,
    { timeout: 30_000 },
  );
};

export default defineHarness({
  name: "chess",
  // The E2E dev server owns 4173; sessions default elsewhere so both can run at once.
  port: 4183,
  defaults: { browser: "webkit", device: "iPhone 13 Mini" },
  dev: {
    command: (port) => [
      "pnpm",
      "--filter",
      "@chess-mcp/ui",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    marker: "/src/index.tsx",
  },
  production: {
    // The engine copy and the chess-tools build are what `pnpm --filter @chess-mcp/ui build`
    // gets from its pre-hook and CI; `vite build` directly, so the output lands in the session
    // directory without the post-hook's hardcoded dist/ assertion running against a stale dist/.
    build: (outDir) => [
      "sh",
      "-c",
      'pnpm --filter @chess-mcp/chess-tools build && pnpm --filter @chess-mcp/ui exec node scripts/copy-engine.mjs && pnpm --filter @chess-mcp/ui exec vite build --outDir "$1" --emptyOutDir',
      "sh",
      outDir,
    ],
  },
  ready,
  // Cloud evaluation defaults on and calls lichess on a timer after every position change; no
  // review or test exercises it, so it is off before first boot.
  // SERIALIZED, runs in the page.
  initScript: () => {
    try {
      localStorage.setItem("chess.cloudeval.enabled", "false");
    } catch {
      /* about:blank has no storage */
    }
  },
  options: ["pgn", "color"],
  fixtures: {
    "rich-repertoire": {
      description:
        "A repertoire PGN loaded through the dev accessor (--pgn FILE --color white|black)",
      prepare: async ({ root, options, resolve }) => {
        const pgnPath = await resolve(options.pgn ?? DEFAULT_PGN);
        const pgn = await readFile(pgnPath, "utf8");
        const { GameTree } = await import(
          pathToFileURL(path.join(root, "packages/chess-tools/dist/index.js")).href
        );
        const tree = GameTree.fromPgn(pgn);
        if (!tree.stats().nodes) throw new Error("Fixture PGN has no legal moves.");
        const color = options.color ?? "white";
        if (!["white", "black"].includes(color)) throw new Error("--color must be white or black.");
        return { pgn, expectedPgn: tree.toPgn(), color, fileName: path.basename(pgnPath) };
      },
      // SERIALIZED
      apply: async (page, seed) => {
        const accessor = await page.evaluate(() => Boolean(window.__chess));
        if (!accessor)
          throw new Error(
            "rich-repertoire loads through the dev accessor; on --target production use --fixture blank.",
          );
        await page.evaluate(({ pgn, color, fileName }) => {
          window.__chess.loadPgn(pgn, fileName);
          window.__chess.setColor(color);
        }, seed);
        await page.waitForFunction(
          ({ expectedPgn, color }) =>
            window.__chess.toPgn() === expectedPgn &&
            window.__chess.color() === color &&
            window.__chess.strategicFitMetadataStatus() === "ready",
          seed,
          { timeout: 30_000 },
        );
        return page.evaluate(() => ({
          pgn: window.__chess.toPgn(),
          color: window.__chess.color(),
          documentId: window.__chess.documentId(),
        }));
      },
    },
    blank: {
      description: "A fresh install's empty board (the only fixture on --target production)",
    },
  },
  defaultFixture: "rich-repertoire",
  state: {
    sections: ["document", "commands", "strategicFit"],
    defaults: ["document", "commands", "strategicFit"],
    // SERIALIZED, runs in the page against the dev accessor (apps/ui/src/index.tsx).
    read: (sections) => {
      const app = window.__chess;
      if (!app) throw new Error("Development state accessors unavailable.");
      const result = {
        url: window.location.href,
        documentId: app.documentId(),
        revision: app.version(),
      };
      if (sections.includes("document"))
        result.document = {
          color: app.color(),
          path: app.currentPath(),
          dirty: app.dirty(),
          changesSinceExport: app.changesSinceExport(),
          fileName: app.fileName() ?? null,
        };
      if (sections.includes("commands"))
        result.commands = Object.fromEntries(
          Object.entries(app.commandStates()).map(([name, command]) => [
            name,
            {
              status: command.status,
              progress: command.progress ?? null,
              error: command.error?.slice(0, 500) ?? null,
              completedAt: command.completedAt ?? null,
              hasResult: command.result !== undefined,
            },
          ]),
        );
      if (sections.includes("strategicFit")) {
        const lifecycle = app.strategicFitLifecycle();
        const current = lifecycle.current_result;
        result.strategicFit = {
          open: app.strategicFitWorkspaceOpen(),
          stage: app.strategicFitWorkspaceStage(),
          metadataStatus: app.strategicFitMetadataStatus(),
          status: lifecycle.status,
          requestId: lifecycle.request_id,
          progress: lifecycle.progress,
          error: lifecycle.error,
          staleReason: lifecycle.stale_reason,
          report: current
            ? {
                id: current.report_id,
                documentId: current.request_snapshot.document_id,
                revision: current.request_snapshot.repertoire_revision,
                findings: current.result.findings.length,
              }
            : null,
        };
      }
      return result;
    },
  },
  faults: {
    // stockfish.ts catches worker faults and reports them this way, so a dead engine otherwise
    // reaches assertions as empty or stale analysis rather than as a failure.
    watchedWarnings: [/^\[engine\]/],
  },
  smoke: {
    dist: "apps/ui/dist",
    // The engine's SharedArrayBuffer needs cross-origin isolation; without these it cannot start.
    requiredHeaders: ["cross-origin-opener-policy", "cross-origin-embedder-policy"],
    ready: async (page) => {
      await page.locator(".board-wrap").waitFor({ state: "visible", timeout: 30_000 });
    },
    // A visible move must survive a reload and an offline reload: the working repertoire in
    // IndexedDB plus the precached shell. apps/ui/test/pwa-lifecycle.mjs additionally proves the
    // update lifecycle and the offline engine; this proves the shipped artifact on its own.
    persist: async (page) => {
      const play = async (from, to) => {
        await page.locator(`.board-keyboard-layer [data-square="${from}"]`).focus();
        await page.keyboard.press("Enter");
        await page.locator(`.board-keyboard-layer [data-square="${to}"]`).focus();
        await page.keyboard.press("Enter");
      };
      await play("e2", "e4");
      // Phone layouts keep a second, hidden move tree: match only what a person can see.
      await page
        .locator(".move-tree")
        .getByText("e4")
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 10_000 });
      // Autosave is debounced: reload before it flushes and the move is legitimately gone. Poll
      // from Node with an awaited boolean — page.waitForFunction does not reliably await an async
      // predicate (a Promise resolving to false still satisfied it), which made this wait a no-op.
      // Never open a database the app has not created: open() would create an empty one.
      const saved = () =>
        page.evaluate(async () => {
          if (!(await indexedDB.databases()).some((db) => db.name === "chess-repertoire"))
            return false;
          return new Promise((resolve) => {
            const request = indexedDB.open("chess-repertoire");
            request.onerror = () => resolve(false);
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains("kv")) {
                db.close();
                return resolve(false);
              }
              const read = db.transaction("kv").objectStore("kv").get("workingRepertoire");
              read.onsuccess = () => {
                db.close();
                resolve(String(read.result?.pgn ?? "").includes("1. e4"));
              };
              read.onerror = () => {
                db.close();
                resolve(false);
              };
            };
          });
        });
      const deadline = Date.now() + 10_000;
      while (!(await saved())) {
        if (Date.now() > deadline) throw new Error("The move never reached IndexedDB.");
        await page.waitForTimeout(250);
      }
      return "e4";
    },
    verify: async (page, move) => {
      await page
        .locator(".move-tree")
        .getByText(move)
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 15_000 });
    },
  },
  e2e: {
    config: "apps/ui/playwright.config.ts",
    prepare: ["pnpm --filter @chess-mcp/chess-tools build"],
    snapshots: ["apps/ui/test/e2e"],
    report: "apps/ui/playwright-report",
  },
  // Critical journeys and what proves each (`pnpm harness scenarios`; CI checks the mapping).
  scenarios: [
    {
      id: "document-identity",
      title: "A working document keeps one identity through edits, saves, reloads and New",
      covers: [
        {
          file: "apps/ui/test/e2e/document-identity.spec.ts",
          test: "initial, import, edit, navigation, save, New, and failed-load identity lifecycle",
        },
        {
          file: "apps/ui/test/e2e/document-identity.spec.ts",
          test: "autosave reload resumes the persisted working document identity",
        },
      ],
    },
    {
      id: "unsaved-work-guard",
      title: "Starting a new document saves unexported work first",
      covers: [
        {
          file: "apps/ui/test/e2e/core-document.spec.ts",
          test: "WP-003 AC-2 AC-3 saves unexported work before starting a new document",
        },
      ],
    },
    {
      id: "export",
      title: "An export downloads without disturbing the document",
      covers: [
        {
          file: "apps/ui/test/e2e/export-download.spec.ts",
          test: "an export downloads, keeps the document intact, and reports a refused retry",
        },
      ],
    },
    {
      id: "illegal-move",
      title: "An illegal drag plays nothing",
      covers: [
        {
          file: "apps/ui/test/e2e/board-moves.spec.ts",
          test: "a drag to a square the piece cannot reach plays nothing",
        },
      ],
    },
    {
      id: "repertoire-scan",
      title: "A repertoire scan lands its results where they are shown",
      covers: [
        {
          file: "apps/ui/test/e2e/repertoire-journey.spec.ts",
          test: "a scan opens the section its results land in",
        },
      ],
    },
    {
      id: "strategic-fit-resolution",
      title: "A recorded Strategic Fit resolution holds",
      covers: [
        {
          file: "apps/ui/test/e2e/strategic-fit-journey.spec.ts",
          test: "a recorded resolution holds and says so",
        },
      ],
    },
    {
      id: "offline-install",
      title: "The shipped PWA installs, restores the document offline, and updates on consent",
      // smoke: this artifact; checks: apps/ui/test/pwa-lifecycle.mjs (offline engine + update flow)
      covers: [{ lane: "smoke" }, { lane: "checks" }],
    },
    {
      id: "ios-installed-pwa",
      title: "Installed PWA on a real iPhone",
      status: "unsupported",
      reason: "Mobile WebKit emulation is not iOS Safari or an installed PWA; needs a device.",
    },
  ],
});
