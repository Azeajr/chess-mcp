import { expect, test, type Locator } from "playwright/test";
import { currentPath, openApp } from "./helpers/app";

async function expectDialogContract(
  page: Parameters<typeof openApp>[0],
  opener: Locator,
  dialog: Locator,
) {
  await opener.focus();
  await opener.click();
  await expect(dialog).toBeVisible();
  const before = await currentPath(page);
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  expect(await currentPath(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
}

test.fixme("UX-007 every overlay traps focus, restores it, and blocks board navigation", async ({
  page,
}) => {
  await openApp(page);
  await expectDialogContract(
    page,
    page.getByRole("button", { name: "Open workspace" }),
    page.getByRole("dialog", { name: "Strategic Fit" }),
  );
  await expectDialogContract(
    page,
    page.getByRole("button", { name: "Open PGN" }),
    page.getByRole("dialog"),
  );
  await expectDialogContract(
    page,
    page.getByRole("button", { name: "New" }),
    page.getByRole("dialog"),
  );
});
