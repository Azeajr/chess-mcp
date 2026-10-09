// Promoted from .web-harness/evidence-discovery.js by `web-harness promote`.
// The batch runs unchanged: step is test.step, assert is expect, faults go through the same guard,
// and the page is seeded with the "rich-repertoire" fixture exactly as a session is.
import type { HarnessBatch } from "@azeajr/web-harness/playwright";
import { applyHarnessFixture, batchHelpers } from "@azeajr/web-harness/playwright";
import harness from "../../../../harness.config.mjs";
import { expect, test } from "./helpers/fixtures";

const batch: HarnessBatch = async (page, { step, assert }) => {
  await step("complete Balanced analysis", async () => {
    await page.getByRole("button", { name: "Open Strategic Fit" }).click();
    await page.getByRole("button", { name: "Use Balanced profile", exact: true }).click();
    await page.locator('[data-analysis-state="completed"]').waitFor({ timeout: 60000 });
    await page.locator("#strategic-fit-stage-findings").click();
    await page.locator('[data-queue-status="ready"]').waitFor();
  });
  await step("distinguish pending decisions from available evidence", async () => {
    assert(
      /0 pending/i.test(await page.locator("#strategic-fit-stage-findings").innerText()),
      "zero explicitly counts pending decisions",
    );
    const evidence = page.locator(".strategic-fit-evidence-checklist");
    assert(
      (await evidence.locator("summary").innerText()).includes(
        "Evidence and information: 10 findings",
      ),
      "all ten findings are discoverable",
    );
    assert(
      await page.getByText("No actionable findings in this report", { exact: true }).isVisible(),
      "empty actionable queue is explained",
    );
    assert(
      !(await page
        .getByText("Adjust the overview focus, priority, or opening filter.", { exact: true })
        .isVisible()),
      "unfiltered report does not blame filters",
    );
    await evidence.locator("summary").click();
    const card = evidence
      .locator(":scope > div")
      .filter({ has: page.getByText("Equivalent move orders", { exact: true }) });
    await card.getByRole("button", { name: "Review evidence", exact: true }).click();
    await page.locator("#strategic-fit-pane-evidence").waitFor();
    await page
      .getByRole("article", { name: "Evidence for Equivalent move orders", exact: true })
      .getByRole("heading", { name: "These move orders reach the same position", exact: true })
      .waitFor();
  });
  await step("return to repertoire with keyboard focus", async () => {
    await page.getByRole("button", { name: "Return to repertoire", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Strategic Fit", exact: true })
      .waitFor({ state: "hidden" });
    assert(
      await page
        .getByRole("button", { name: "Open Strategic Fit" })
        .evaluate((el) => el === document.activeElement),
      "focus returns to opener",
    );
  });
};

test("evidence remains discoverable with zero pending decisions @mobile-webkit", async ({
  page,
  allowPageFaults,
  expectPageFault,
}) => {
  await applyHarnessFixture(page, harness, "rich-repertoire");
  const helpers = batchHelpers(page, harness, {
    test,
    expect,
    allowPageFaults,
    expectPageFault,
    target: "dev",
  });
  const result = await batch(page, helpers);
  await test.info().attach("batch-result.json", {
    body: JSON.stringify(result ?? null, null, 2),
    contentType: "application/json",
  });
});
