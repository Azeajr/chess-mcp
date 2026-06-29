---
name: run-ui
description: Build, run, and drive the chess-repertoire PWA (apps/ui). Use when asked to start the UI/PWA, run the dev server, screenshot the app, or drive a panel (Gaps / Congruence / Connect / Shorten + the inspect "?") headlessly.
---

The `apps/ui` SolidJS PWA. An agent can't open a browser window, so "run it" means: start the Vite dev server, then drive headless Chromium via the committed Playwright driver `.claude/skills/run-ui/driver.mjs`. The driver loads a repertoire through the DEV-only `window.__chess` hook (the native file picker can't be driven headless), runs a scan panel, clicks Inspect, and screenshots. The app's real engine (Stockfish lite-single wasm Worker) runs under headless Chromium.

**Run every command from the repo root** (the pnpm workspace root) — `--filter @chess-mcp/ui` and `node apps/ui/...` both assume it, and the driver needs the repo-root `node_modules` to resolve `playwright`.

## Prerequisites

No `apt-get` needed here — headless Chromium runs without extra system libs in this container. You need the Playwright browser binary:

```bash
pnpm --filter @chess-mcp/ui exec playwright install chromium
```

(Prints "your OS is not officially supported … downloading fallback build for ubuntu24.04-x64" — that fallback is what the driver launches. Fine.)

## Setup

```bash
pnpm install --frozen-lockfile
```

## Run (agent path)

Start the dev server in the background and poll the port (don't `sleep` — `__chess` only exists on the **dev** server):

```bash
(pnpm --filter @chess-mcp/ui dev > /tmp/vite.log 2>&1 &)
timeout 40 bash -c 'until curl -sf http://localhost:5173/ >/dev/null 2>&1; do sleep 1; done' && echo "server up"
```

Drive it — load a repertoire, scan the Shorten panel, inspect every suggestion, screenshot each:

```bash
OUT=/tmp/run-ui PANEL=Shorten node apps/ui/.claude/skills/run-ui/driver.mjs
```

Screenshots land in `$OUT` (default `./_run-ui-screens`): `00-loaded.png`, `10-<PANEL>-scan.png`, `20-<PANEL>-inspect-N.png`. The driver prints each inspect verdict and the console-error list, and exits non-zero if the page logged any error. **Look at a screenshot** — a blank frame means it didn't load.

Stop the server when done: `pkill -f vite` (returns non-zero after killing — that's expected; confirm with `pgrep -f apps/ui`).

Env knobs (all optional):

| var | default | meaning |
|---|---|---|
| `PANEL` | _(none)_ | `Shorten` \| `Gaps` \| `Congruence` \| `Connect` — scan it; `Shorten` also clicks Inspect (?). Omit → just load + screenshot. |
| `PGN` | a graded-fit sample | inline PGN, or a path to a `.pgn` file |
| `COLOR` | `white` | repertoire side |
| `URL` | `http://localhost:5173/` | dev server |
| `OUT` | `./_run-ui-screens` | screenshot dir |

## Run (human path)

```bash
pnpm --filter @chess-mcp/ui dev   # → http://localhost:5173, click "Open PGN". Ctrl-C to stop. Useless headless (native file picker).
```

## Test

No engine-free CI smoke of its own — typecheck + a production build is the gate:

```bash
pnpm --filter @chess-mcp/ui typecheck && pnpm --filter @chess-mcp/ui build
```

## Gotchas

- **`window.__chess` is DEV-only** (`import.meta.env.DEV`, defined in `src/index.tsx`). It exists on the `vite dev` server but NOT in a `pnpm build` preview. The driver depends on it to load a PGN without the native file picker.
- **Scan `<details>` won't open by clicking "Scan".** The Scan button calls `preventDefault`, so it does NOT toggle the `<details>` — and the suggestion rows live in the collapsed body. The driver sets `.open = true` first; do the same for any new panel.
- **Native file load can't be driven headless** — the app uses the File System Access API (`showOpenFilePicker`, `src/store/files.ts`). Use `window.__chess.loadPgn(pgn, name)` + `setColor(...)` instead.
- **Degenerate fit on tiny repertoires.** A 2-leaf transposition makes every branch self-score `fit 1→1` (the Shorten inspect then shows the "fit weak — branches resemble the repertoire about equally" flag, correctly). For graded fits, use a richer multi-structure repertoire — the driver's default PGN (London family + a QID fianchetto join) yields `fit 0.33 / 0.5`.
- **Scans are engine-backed** (browser Stockfish wasm) — a Shorten scan takes ~tens of seconds; the driver waits up to 120s.
- **Playwright "OS not officially supported"** — harmless; it uses the ubuntu24.04 fallback build. Always launch with `args: ["--no-sandbox"]` (the driver does).

## Troubleshooting

- **`waitForFunction` times out on `window.__chess`**: you're not on a dev build. Use `pnpm --filter @chess-mcp/ui dev`, not a build preview.
- **`Cannot find package 'playwright'`**: run the driver from the repo root, not from `apps/ui` — `node` resolves `playwright` from the repo-root `node_modules`.
- **Shorten shows "No shortenable lines."**: the repertoire has no cross-branch transposition to shorten. Use one that does (the default PGN, or any repertoire with two move-orders converging).
