/**
 * Headless driver for the chess-repertoire PWA (apps/ui). Loads a repertoire via the DEV-only
 * `window.__chess` hook (no native file picker), optionally drives a scan/inspect panel, and
 * screenshots. The app's real engine (Stockfish lite-single wasm Worker) runs under headless
 * Chromium. Assumes the Vite dev server is already up (see SKILL.md).
 *
 * Run from the REPO ROOT so `playwright` resolves:
 *   node apps/ui/.claude/skills/run-ui/driver.mjs
 *
 * Env knobs (all optional):
 *   URL=http://localhost:5173/   dev server
 *   COLOR=white|black            repertoire side (default white)
 *   PANEL=Shorten|Gaps|Congruence|Connect   scan this panel; Shorten also clicks Inspect (?)
 *   OUT=<dir>                    screenshot dir (default: ./_run-ui-screens)
 *   PGN=<inline PGN | file path> repertoire (default: a graded-fit multi-structure sample)
 */
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:5173/";
const COLOR = process.env.COLOR ?? "white";
const PANEL = process.env.PANEL ?? "";
const OUT = process.env.OUT ?? "./_run-ui-screens";
// Default: a multi-structure repertoire (London family + one QID fianchetto join) → graded fit, and
// a Shorten suggestion. A tiny 2-leaf transposition gives degenerate fit (every branch self-scores 1).
const DEFAULT_PGN = [
  "1. d4 Nf6 2. Nf3 e6 3. Bf4 c5 4. e3 *",
  "1. d4 Nf6 2. Nf3 d6 3. Bf4 Nbd7 *",
  "1. d4 d5 2. Nf3 e6 3. Bf4 c5 *",
  "1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Bb7 5. Bg2 Be7 *",
].join("\n\n");
const PGN = process.env.PGN ? (existsSync(process.env.PGN) ? readFileSync(process.env.PGN, "utf8") : process.env.PGN) : DEFAULT_PGN;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
// __chess exists only in dev builds (import.meta.env.DEV) — it's the headless load hook.
await page.waitForFunction(() => !!window.__chess, null, { timeout: 20000 });
await page.evaluate(([pgn, color]) => { window.__chess.loadPgn(pgn, "driver.pgn"); window.__chess.setColor(color); }, [PGN, COLOR]);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/00-loaded.png`, fullPage: true });
console.log(`loaded repertoire (${COLOR}); app screenshot → ${OUT}/00-loaded.png`);

if (PANEL) {
  // Each scan panel is a <details class="rep-section"> with a "Scan" button in its <summary>.
  // The button calls preventDefault, so clicking it does NOT toggle the <details> — open it first
  // or the suggestion rows (in the collapsed body) never appear.
  const section = page.locator("details.rep-section", { has: page.getByText(PANEL, { exact: true }) });
  await section.evaluate((d) => (d.open = true));
  await section.getByRole("button", { name: "Scan" }).click();
  console.log(`scanning ${PANEL} (engine-backed; up to ~2 min)…`);
  await section.locator(".rep-row, .empty").first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: `${OUT}/10-${PANEL}-scan.png`, fullPage: true });

  const inspects = section.locator("button.inspect-btn");
  const n = await inspects.count();
  console.log(`${PANEL}: ${await section.locator(".rep-row .bridge-icon").count()} suggestion(s), ${n} inspectable`);
  for (let i = 0; i < n; i++) {
    await inspects.nth(i).click();
    await section.locator(".shortcut-detail .muted").first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const detail = (await section.locator(".shortcut-detail").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const warn = await section.locator(".shortcut-detail .warn").allInnerTexts();
    console.log(`  inspect[${i}]: ${detail}`);
    await page.screenshot({ path: `${OUT}/20-${PANEL}-inspect-${i}.png`, fullPage: true });
  }
}

console.log("console errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
