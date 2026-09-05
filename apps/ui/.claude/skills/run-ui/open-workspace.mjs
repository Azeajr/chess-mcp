import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5173/";
const OUT = process.env.OUT ?? "/tmp/run-ui";
const DEFAULT_PGN = [
  "1. d4 Nf6 2. Nf3 e6 3. Bf4 c5 4. e3 *",
  "1. d4 Nf6 2. Nf3 d6 3. Bf4 Nbd7 *",
  "1. d4 d5 2. Nf3 e6 3. Bf4 c5 *",
  "1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Bb7 5. Bg2 Be7 *",
].join("\n\n");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__chess, null, { timeout: 20000 });
await page.evaluate(
  ([pgn]) => {
    window.__chess.loadPgn(pgn, "driver.pgn");
    window.__chess.setColor("white");
  },
  [DEFAULT_PGN],
);
await page.waitForTimeout(500);

await page.getByRole("button", { name: "Open Strategic Fit" }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/30-strategic-fit-workspace.png`, fullPage: true });
console.log("screenshotted workspace →", `${OUT}/30-strategic-fit-workspace.png`);

const stageLabels = await page
  .locator('[aria-label="Strategic Fit stages"] *')
  .allInnerTexts()
  .catch(() => []);
console.log("stage nav text:", JSON.stringify(stageLabels).slice(0, 500));

const useBalanced = page.getByRole("button", { name: "Use Balanced profile" });
if (await useBalanced.count()) {
  await useBalanced.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/31-after-profile.png`, fullPage: true });
  console.log("screenshotted after profile →", `${OUT}/31-after-profile.png`);
  const stageLabels2 = await page
    .locator('[aria-label="Strategic Fit stages"] *')
    .allInnerTexts()
    .catch(() => []);
  console.log("stage nav text (post-profile):", JSON.stringify(stageLabels2).slice(0, 800));

  const runBtn = page.getByRole("button", { name: /run|analyz|scan/i }).first();
  if (await runBtn.count()) {
    console.log("found run-ish button:", await runBtn.innerText());
    await runBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/32-after-run-click.png`, fullPage: true });
    console.log("screenshotted after run click →", `${OUT}/32-after-run-click.png`);
  } else {
    console.log("no run/analyze button found");
  }
}

console.log("console errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
