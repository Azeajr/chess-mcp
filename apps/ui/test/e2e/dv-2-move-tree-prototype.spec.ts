import { expect, test, type Page } from "playwright/test";

const prototypePath = "/prototypes/dv-2-move-tree.html";

async function openPrototype(page: Page, mapping: string) {
  await page.goto(`${prototypePath}?mapping=${mapping}`);
  const tree = page.getByRole("tree", { name: "Sample branching repertoire" });
  await tree.focus();
  await expect(tree).toHaveAttribute("aria-activedescendant", "dv2-nf3");
  await expect(page.getByTestId("focus")).toHaveText("2. Nf3");
  return tree;
}

test.describe("DV-2 move-tree prototype", () => {
  test("uses the documented fallback for an omitted or invalid mapping", async ({ page }) => {
    await page.goto(prototypePath);
    await expect(page.getByTestId("mapping")).toHaveText("Right Arrow enters a variation");

    await page.goto(`${prototypePath}?mapping=not-a-mapping`);
    await expect(page.getByTestId("mapping")).toHaveText("Right Arrow enters a variation");
  });

  test("keeps the two Right Arrow mappings distinct at the 2. Nf3 branch", async ({ page }) => {
    const enteringVariation = await openPrototype(page, "enter-variation");
    await enteringVariation.press("ArrowRight");
    await expect(page.getByTestId("focus")).toHaveText("2... d6");

    const advancingMainline = await openPrototype(page, "advance-mainline");
    await advancingMainline.press("ArrowRight");
    await expect(page.getByTestId("focus")).toHaveText("2... Nc6");
  });

  test("synthetic proxy evaluation 1 completes the task with Right Arrow entering a variation", async ({
    page,
  }) => {
    const enteringVariation = await openPrototype(page, "enter-variation");
    await enteringVariation.press("ArrowRight");
    await enteringVariation.press("ArrowDown");
    await enteringVariation.press("ArrowRight");
    await expect(page.getByTestId("focus")).toHaveText("3. Nxe5");
    await expect(page.getByTestId("task-status")).toHaveText(
      "Task complete: second variation reached at 3. Nxe5.",
    );
    await expect(page.getByTestId("task-metrics")).toContainText("wrong navigation keys: 0");
  });

  test("synthetic proxy evaluation 2 completes the task with Right Arrow advancing the mainline", async ({
    page,
  }) => {
    const advancingMainline = await openPrototype(page, "advance-mainline");
    await advancingMainline.press("ArrowRight");
    await advancingMainline.press("ArrowDown");
    await advancingMainline.press("ArrowDown");
    await advancingMainline.press("ArrowRight");
    await expect(page.getByTestId("focus")).toHaveText("3. Nxe5");
    await expect(page.getByTestId("task-status")).toHaveText(
      "Task complete: second variation reached at 3. Nxe5.",
    );
    await expect(page.getByTestId("task-metrics")).toContainText("wrong navigation keys: 0");
  });

  test("exercises sibling, parent, boundary, and activation behavior", async ({ page }) => {
    const tree = await openPrototype(page, "enter-variation");
    await tree.press("ArrowRight");
    await tree.press("ArrowDown");
    await expect(page.getByTestId("focus")).toHaveText("2... Nf6");
    await tree.press("ArrowUp");
    await expect(page.getByTestId("focus")).toHaveText("2... d6");
    await tree.press("ArrowLeft");
    await expect(page.getByTestId("focus")).toHaveText("2. Nf3");
    await tree.press("Home");
    await expect(page.getByTestId("focus")).toHaveText("1. e4");
    await tree.press("End");
    await expect(page.getByTestId("focus")).toHaveText("3. Nxe5");
    await tree.press("Enter");
    await expect(page.getByTestId("navigation-target")).toHaveText(
      "Would navigate the board to 3. Nxe5.",
    );
  });
});
