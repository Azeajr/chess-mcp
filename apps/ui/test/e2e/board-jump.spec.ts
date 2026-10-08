import { expect, test, type Page } from "./helpers/fixtures";
import { currentPath, openApp } from "./helpers/app";

// Found by the repertoire UX review: below 640px of height the workspace scrolls and takes the
// board with it, so opening a structure match moved a board 800px above the viewport and the only
// visible change was the row's highlight.

const SHORT_PHONE = { width: 375, height: 629 };
const TALL_PHONE = { width: 390, height: 844 };

const structureSearch = (page: Page) =>
  page
    .locator("details.rep-section")
    .filter({ has: page.getByText("Structure search", { exact: true }) });

async function openGrunfeldMatch(page: Page) {
  const section = structureSearch(page);
  await section.locator("summary").click();
  await section.getByRole("combobox", { name: "Structure name" }).fill("Grünfeld Centre");
  await section.getByRole("button", { name: "Search", exact: true }).click();
  const row = section.locator(".rep-row").first();
  await expect(row).toContainText("Grünfeld Centre");
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect.poll(() => currentPath(page).then((path) => path.length)).toBe(13);
  return row;
}

test("opening a finding with the board scrolled away offers a jump there and back", async ({
  page,
}) => {
  await openApp(page, SHORT_PHONE);
  const row = await openGrunfeldMatch(page);
  await expect(page.locator(".board-stage")).not.toBeInViewport();

  const show = page.getByRole("button", { name: "Show board" });
  await expect(show).toBeInViewport();
  const rowTop = (await row.boundingBox())!.y;

  await show.click();
  await expect(page.locator(".board-stage")).toBeInViewport({ ratio: 0.9 });
  const back = page.getByRole("button", { name: "Back to list" });
  await expect(back).toBeInViewport();
  const board = (await page.locator(".board-wrap").boundingBox())!;
  const pill = (await back.boundingBox())!;
  expect(pill.y, "the jump back sits below the board, not over it").toBeGreaterThanOrEqual(
    board.y + board.height,
  );

  await back.click();
  await expect(back).toHaveCount(0);
  await expect(row).toBeInViewport();
  expect(Math.abs((await row.boundingBox())!.y - rowTop)).toBeLessThan(2);
  expect(await currentPath(page)).toHaveLength(13);
});

test("no jump is offered while the board stays in view", async ({ page }) => {
  await openApp(page, TALL_PHONE);
  await openGrunfeldMatch(page);
  await expect(page.locator(".board-stage")).toBeInViewport();
  await expect(page.locator(".board-jump")).toHaveCount(0);
});
