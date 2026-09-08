import { expect, test } from "./helpers/fixtures";
import { currentPgn, openApp } from "./helpers/app";

type Page = import("playwright/test").Page;

// One line on purpose: the export analyses every position with the local engine, and the subject
// here is the export and download wiring, not engine coverage.
const ONE_LINE = "1. d4 d5 2. c4 *";

const generate = (page: Page) =>
  page.getByRole("button", { name: "Generate annotated repertoire", exact: true });
const downloadAgain = (page: Page) => page.getByRole("button", { name: "Download again" });
const section = (page: Page) =>
  page.locator("details").filter({ hasText: "Annotated repertoire" }).first();

test("an export downloads, keeps the document intact, and reports a refused retry", async ({
  page,
}) => {
  // The export runs the engine over the whole line before it produces a file.
  test.setTimeout(180_000);

  await openApp(page, {
    width: 1280,
    height: 900,
    pgn: ONE_LINE,
    fileName: "one-line.pgn",
  });

  const before = await currentPgn(page);

  const download = page.waitForEvent("download", { timeout: 150_000 });
  await generate(page).click();
  const file = await download;

  expect(file.suggestedFilename()).toContain("annotated");
  // Exporting a copy must not touch the open document.
  expect(await currentPgn(page)).toBe(before);

  // Nothing else on the page says a file was produced, so this control is both the confirmation
  // and the way back to the file without recomputing the export.
  await expect(downloadAgain(page)).toBeVisible();

  // The store reported a refused download and the caller dropped it, so a download that never
  // happened looked exactly like one that did.
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("blocked for the test");
    };
  });
  await downloadAgain(page).click();

  const alert = section(page).getByRole("alert");
  await expect(alert).toContainText("Export could not be downloaded");
  await expect(alert).toContainText("blocked the download");
  await expect(downloadAgain(page)).toBeVisible();
});
