import { expect, test, type Page } from "./helpers/fixtures";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "balanced"): unknown;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) =>
  page.evaluate(
    ({ source, arg }) =>
      Function(
        "api",
        "arg",
        `return (${source})(api, arg)`,
      )((window as unknown as { __chess: ChessHarness }).__chess, arg),
    { source: fn.toString(), arg },
  );

const FLOW_REPERTOIRE = `[Event "Flow: move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 *

[Event "Flow: move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 *

[Event "Flow: early h6"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 h6 6. Bh4 O-O 7. e3 *

[Event "Flow: Nbd7 setup"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 O-O 6. e3 Nbd7 7. Rc1 *`;

async function bootstrap(page: Page, pgn: string, name: string) {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, input) => api.loadPgn(input.pgn, input.name), { pgn, name });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({
    timeout: 15_000,
  });
  return dialog;
}

test("the decision flow shows weighted player and opponent steps with an outline equivalent", async ({
  page,
}) => {
  const dialog = await bootstrap(page, FLOW_REPERTOIRE, "flow-complete.pgn");
  const before = await chess(page, (api) => api.toPgn());
  const flow = dialog.locator(".decision-flow");
  await expect(flow).toHaveAttribute("data-flow-state", "available");
  await expect(flow).toHaveAttribute("data-flow-projection-version", "1.0.0");

  await expect(flow.locator("[data-flow-node-kind='start']")).toHaveCount(1);
  await expect(flow.locator("[data-flow-node-kind='mode']").first()).toBeVisible();
  await expect(flow.locator("[data-flow-actor='player']").first()).toBeVisible();
  await expect(flow.locator("[data-flow-actor='opponent']").first()).toBeVisible();
  await expect(flow.locator("[data-flow-branching='true']").first()).toBeVisible();

  const outline = flow.locator("[data-flow-outline]");
  await expect(outline).toBeVisible();
  const outlineRows = outline.locator("[data-flow-outline-row]");
  const nodeCount = await flow.locator("[data-flow-node]").count();
  await expect(outline).toHaveAttribute("data-flow-outline-total", String(nodeCount));
  await expect(outline).toHaveAttribute("aria-rowcount", String(nodeCount));
  const mountedOutlineRows = Number(await outline.getAttribute("data-flow-outline-mounted"));
  expect(mountedOutlineRows).toBeLessThanOrEqual(60);
  await expect(outlineRows).toHaveCount(Math.min(nodeCount, mountedOutlineRows));
  await expect(outline.locator("[data-flow-outline-actor='player']").first()).toContainText(
    "You play",
  );
  await expect(outline.locator("[data-flow-outline-actor='opponent']").first()).toContainText(
    "Opponent plays",
  );

  const startNode = flow.locator("[data-flow-node-kind='start']");
  await startNode.click();
  const detail = flow.locator("[data-flow-detail]");
  await expect(detail).toBeVisible();
  await expect(detail.locator("[data-flow-detail-share]")).toHaveText("100%");
  await expect(detail.locator("[data-flow-detail-actor]")).toContainText("Start");

  expect(await chess(page, (api) => api.toPgn())).toBe(before);
});

test("selecting a flow step with findings opens the canonical finding queue", async ({ page }) => {
  const dialog = await bootstrap(page, FLOW_REPERTOIRE, "flow-selection.pgn");
  const flow = dialog.locator(".decision-flow");
  const rowWithFinding = flow.locator("[data-flow-outline-row]").first();
  await rowWithFinding.getByRole("button").first().click();

  const openFinding = flow.locator("[data-flow-open-finding]").first();
  await expect(openFinding).toBeVisible();
  const findingId = await openFinding.getAttribute("data-flow-open-finding");
  await openFinding.click();

  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute(
    "data-stage",
    "findings",
  );
  const findings = dialog.locator("#strategic-fit-pane-findings");
  await expect(findings.getByRole("status")).toContainText("Findings for the selected flow step");
  await expect(findings.locator(`[data-finding-id='${findingId}']`)).toHaveAttribute(
    "data-finding-selected",
    "true",
  );
});

test("uncertain causal ownership is written out and the keyboard reaches every step", async ({
  page,
}) => {
  const dialog = await bootstrap(page, FLOW_REPERTOIRE, "flow-causality.pgn");
  const flow = dialog.locator(".decision-flow");

  const outlineCausality = flow.locator("[data-flow-outline-causality]").first();
  await expect(outlineCausality).toBeVisible();
  const labels = await flow
    .locator("[data-flow-outline-causality]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-flow-outline-causality")));
  expect(labels.every((label) => label !== null && label.length > 0)).toBe(true);
  await expect(flow.locator("[data-flow-causality='not-referenced']").first()).toBeVisible();

  const decisionNode = flow.locator("[data-flow-node-kind='decision']").first();
  await decisionNode.focus();
  await expect(decisionNode).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(flow.locator("[data-flow-detail]")).toBeVisible();

  const summary = await flow.locator("[data-flow-screen-reader-summary]").textContent();
  expect(summary).toContain("Decision flow across");
  expect(summary).toContain("causal evidence");
});

test("the flow stays contained and legible on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await bootstrap(page, FLOW_REPERTOIRE, "flow-mobile.pgn");
  const flow = dialog.locator(".decision-flow");
  await flow.scrollIntoViewIfNeeded();
  await expect(flow.locator("[data-flow-outline]")).toBeVisible();

  const scroll = flow.locator(".decision-flow-scroll");
  const overflow = await scroll.evaluate((element) => getComputedStyle(element).overflowX);
  expect(["auto", "scroll"]).toContain(overflow);
  const contained = await scroll.evaluate(
    (element) => element.clientWidth <= (element.closest(".decision-flow")?.clientWidth ?? 0) + 1,
  );
  expect(contained).toBe(true);

  const outlineButton = flow.locator("[data-flow-outline-row] button").first();
  const size = await outlineButton.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await outlineButton.click();
  await expect(flow.locator("[data-flow-detail]")).toBeVisible();
});
