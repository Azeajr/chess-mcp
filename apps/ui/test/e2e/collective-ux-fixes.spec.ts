import { expect, test } from "./helpers/fixtures";
import { openApp, currentPgn } from "./helpers/app";
import { touchTargetViolations } from "./helpers/accessibility";
import { GameTree } from "@chess-mcp/chess-tools";

test("starting a collapsed operation exposes its input validation error", async ({ page }) => {
  await openApp(page);
  const section = page
    .locator("details.rep-section")
    .filter({ has: page.getByText("Structure search", { exact: true }) });
  await expect(section).not.toHaveAttribute("open", "");
  await section.getByRole("button", { name: "Search", exact: true }).click();
  await expect(section).toHaveAttribute("open", "");
  await expect(section.locator("[role=alert]")).toBeVisible();
  // The code itself is technical detail, as it already was on the chat card (WP-026 AC-1).
  await expect(section.locator("[role=alert]")).toContainText("Search criteria required");
});

test("Save status is reachable by keyboard and describes browser storage separately from export", async ({
  page,
}) => {
  await openApp(page, { width: 375, height: 629 });
  const menu = page.getByRole("button", { name: "Repertoire", exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  const entry = page.getByRole("menuitem", { name: "Save status", exact: true });
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(entry).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Save status" });
  await expect(dialog).toContainText("Stored in this browser");
  await expect(dialog).toContainText("No changes to export");
  await expect(dialog).toContainText("Use Save to export a PGN file");
  const minimum = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? 44 : 24));
  expect(
    (await dialog.getByRole("button", { name: "Close save status" }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(minimum);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test("annotation expands its status, cancels, retries and downloads a branching copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openApp(page, { pgn: "1. e4 (1. d4 d5) e5 *" });
  const before = await currentPgn(page);
  const section = page
    .locator("details.rep-section")
    .filter({ has: page.getByText("Annotated repertoire", { exact: true }) });
  await expect(section).not.toHaveAttribute("open", "");
  await section.getByRole("button", { name: "Generate annotated repertoire", exact: true }).click();
  await expect(section).toHaveAttribute("open", "");
  await section
    .getByRole("button", { name: "Cancel annotated repertoire generation", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Generate annotated repertoire", exact: true }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download", { timeout: 60_000 });
  await section.getByRole("button", { name: "Generate annotated repertoire", exact: true }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  let pgn = "";
  for await (const chunk of stream) pgn += chunk.toString();
  const tree = GameTree.fromPgn(pgn);
  expect(tree.childSansAt([])).toEqual(expect.arrayContaining(["e4", "d4"]));
  expect(pgn).toContain("Strategic Fit");
  expect(await currentPgn(page)).toBe(before);
  await expect(section).toContainText("1 result");
});

test(
  "expanded annotation controls meet the touch target minimum on the review phone",
  { tag: "@mobile-webkit" },
  async ({ page }) => {
    await openApp(page, { pgn: "1. e4 (1. d4 d5) e5 *" });
    const section = page
      .locator("details.rep-section")
      .filter({ has: page.getByText("Annotated repertoire", { exact: true }) });
    // The operation button inside the summary deliberately does not toggle disclosure, so the
    // label is what opens it. UX-10 was raised against controls that are hidden until then.
    await section.getByText("Annotated repertoire", { exact: true }).tap();
    await expect(section).toHaveAttribute("open", "");
    // UX-10 asked for measured bounds, not an impression: violations name the control and its
    // hit rectangle, so a real regression reports which selector shrank and to what.
    expect(await touchTargetViolations(section, 44)).toEqual([]);
    expect(await touchTargetViolations(page.locator(".app-main"), 44)).toEqual([]);
  },
);

test("application reloads do not create ownerless reactive computations", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await openApp(page, { width: 375, height: 629 });
  await page.getByRole("tab", { name: "Moves", exact: true }).click();
  await page.getByRole("tab", { name: "Analysis", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Repertoire", exact: true })).toBeVisible();
  expect(warnings.filter((message) => message.includes("will never be disposed"))).toEqual([]);
});
