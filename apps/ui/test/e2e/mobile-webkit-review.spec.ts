import { expect, test } from "./helpers/fixtures";
import { currentPgn, openApp } from "./helpers/app";

test(
  "phone profile setup remains reachable and returns to the unchanged repertoire",
  { tag: "@mobile-webkit" },
  async ({ page }) => {
    await openApp(page);
    const pgn = await currentPgn(page);
    const open = page.getByRole("button", { name: "Open Strategic Fit" });
    await open.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "How should Strategic Fit review your repertoire?" }),
    ).toBeVisible();
    const accept = dialog.getByRole("button", { name: "Use Balanced profile" });
    // The full mobile descriptor makes this a touch/scroll reachability contract, not just a width test.
    await accept.scrollIntoViewIfNeeded();
    await expect(accept).toBeInViewport();
    await accept.tap();
    await expect(
      dialog.getByRole("heading", { name: "How should Strategic Fit review your repertoire?" }),
    ).toHaveCount(0);
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const back = dialog.getByRole("button", { name: "Return to repertoire" });
    await back.tap();
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(await currentPgn(page)).toBe(pgn);
  },
);
