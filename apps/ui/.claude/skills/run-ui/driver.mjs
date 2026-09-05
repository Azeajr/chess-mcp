import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:5173/";
const COLOR = process.env.COLOR ?? "white";
const PANEL = process.env.PANEL ?? "";
const OUT = process.env.OUT ?? "./_run-ui-screens";
const DEFAULT_PGN = [
  "1. d4 Nf6 2. Nf3 e6 3. Bf4 c5 4. e3 *",
  "1. d4 Nf6 2. Nf3 d6 3. Bf4 Nbd7 *",
  "1. d4 d5 2. Nf3 e6 3. Bf4 c5 *",
  "1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Bb7 5. Bg2 Be7 *",
].join("\n\n");
const PGN = process.env.PGN
  ? existsSync(process.env.PGN)
    ? readFileSync(process.env.PGN, "utf8")
    : process.env.PGN
  : DEFAULT_PGN;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__chess, null, { timeout: 20000 });
await page.evaluate(
  ([pgn, color]) => {
    window.__chess.loadPgn(pgn, "driver.pgn");
    window.__chess.setColor(color);
  },
  [PGN, COLOR],
);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/00-loaded.png`, fullPage: true });
console.log(`loaded repertoire (${COLOR}); app screenshot → ${OUT}/00-loaded.png`);

if (PANEL) {
  const section = page.locator("details.rep-section", {
    has: page.getByText(PANEL, { exact: true }),
  });
  await section.evaluate((d) => (d.open = true));
  await section.getByRole("button", { name: "Scan" }).click();
  console.log(`scanning ${PANEL} (engine-backed; up to ~2 min)…`);
  await section.locator(".rep-row, .empty").first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: `${OUT}/10-${PANEL}-scan.png`, fullPage: true });

  const inspects = section.locator("button.inspect-btn");
  const n = await inspects.count();
  console.log(
    `${PANEL}: ${await section.locator(".rep-row .bridge-icon").count()} suggestion(s), ${n} inspectable`,
  );
  for (let i = 0; i < n; i++) {
    await inspects.nth(i).click();
    await section
      .locator(".shortcut-detail .muted")
      .first()
      .waitFor({ timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    const detail = (
      await section
        .locator(".shortcut-detail")
        .first()
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();
    console.log(`  inspect[${i}]: ${detail}`);
    await page.screenshot({ path: `${OUT}/20-${PANEL}-inspect-${i}.png`, fullPage: true });
  }
}

console.log("console errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
