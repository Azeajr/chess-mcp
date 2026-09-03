import { expect, test, type Page } from "playwright/test";

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

const FIRST = [
  "a6",
  "b6",
  "c6",
  "d5",
  "d6",
  "h6",
  "h5",
  "g6",
  "a5",
  "b5",
  "c5",
  "f5",
  "Na6",
  "Nc6",
];
const FIFTH = [
  "Bg5",
  "Bf4",
  "Qc2",
  "a3",
  "Nd2",
  "g3",
  "h3",
  "Rb1",
  "Bd2",
  "Qb3",
  "h4",
  "a4",
  "Qd3",
  "Rg1",
  "Ne5",
  "Qd2",
];

/** The same 416-branch fixture the Task 10.4 hardening suite uses, well past every render bound. */
function largeRepertoire(): string {
  const games: string[] = [];
  for (const first of FIRST) {
    for (const fifth of FIFTH) {
      for (const black of ["O-O", "h6"]) {
        if (black === "h6" && (first === "h6" || first === "h5")) continue;
        games.push(
          `[Event "Large ${first} ${fifth} ${black}"]\n[Result "*"]\n\n` +
            `1. d4 ${first} 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. ${fifth} ${black} ` +
            `6. e3 Ne4 7. Be2 Nxc3 8. bxc3 *`,
        );
      }
    }
  }
  return games.join("\n\n");
}

const LARGE_REPERTOIRE = largeRepertoire();

async function bootstrap(page: Page, pgn: string, name: string, timeout = 25_000) {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api, input) => api.loadPgn(input.pgn, input.name), { pgn, name });
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
  await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  await page.getByRole("button", { name: "Open Strategic Fit" }).click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await dialog.getByRole("button", { name: "Analyze strategic fit" }).click();
  await expect(dialog.locator("[data-analysis-state='completed']")).toBeVisible({ timeout });
  // Both scenarios in this file are about the finding queue, and the workspace shows one stage at
  // a time at every width — so open the stage the queue lives on, as a reader would.
  await dialog.locator("#strategic-fit-stage-findings").click();
  await expect(dialog.locator(".strategic-fit-workspace-body")).toHaveAttribute(
    "data-stage",
    "findings",
  );
  return dialog;
}

/*
 * @engine-bound: both scenarios below run a real Strategic Fit scan over LARGE_REPERTOIRE. On
 * WebKit that scan does not reach `completed` inside the 25 s analysis budget, so the tests fail on
 * scan throughput rather than on the paging behaviour they assert. Chromium and Firefox cover the
 * behaviour; re-measure before widening.
 */
test(
  "a large report bounds mounted finding rows while the queue reports its logical totals",
  {
    tag: "@engine-bound",
  },
  async ({ page }) => {
    test.slow();
    const dialog = await bootstrap(page, LARGE_REPERTOIRE, "large-report-queue.pgn");
    const before = await chess(page, (api) => api.toPgn());

    const queue = dialog.locator(".strategic-fit-finding-queue");
    await expect(queue).toHaveAttribute("data-queue-status", "ready", { timeout: 20_000 });
    const list = queue.locator("[data-finding-list]");
    const total = Number(await list.getAttribute("data-finding-rows-total"));
    expect(total).toBeGreaterThan(6);

    const mounted = Number(await list.getAttribute("data-finding-rows-mounted"));
    expect(mounted).toBeLessThanOrEqual(6);
    await expect(list.locator("> li")).toHaveCount(mounted);

    // Screen readers navigate the logical total, not the mounted rows.
    await expect(list).toHaveAttribute("aria-label", new RegExp(`of ${total} matching`, "u"));
    await expect(list.locator("> li").first()).toHaveAttribute("aria-setsize", String(total));
    await expect(list.locator("> li").first()).toHaveAttribute("aria-posinset", "1");

    expect(await chess(page, (api) => api.toPgn())).toBe(before);
  },
);

test(
  "a selected finding that pages off screen stays selected and stays reachable",
  {
    tag: "@engine-bound",
  },
  async ({ page }) => {
    test.slow();
    const dialog = await bootstrap(page, LARGE_REPERTOIRE, "large-report-selection.pgn");
    const before = await chess(page, (api) => api.toPgn());

    const queue = dialog.locator(".strategic-fit-finding-queue");
    await expect(queue).toHaveAttribute("data-queue-status", "ready", { timeout: 20_000 });
    const list = queue.locator("[data-finding-list]");
    const total = Number(await list.getAttribute("data-finding-rows-total"));
    // The scenario is paging behaviour, so multiple pages are a precondition of the test, not a
    // condition to skip on. A runtime `test.skip(total <= 6, …)` would let the whole scenario
    // silently stop running — still reporting green — if the fixture ever produced one page.
    expect(total, "fixture must produce multiple pages of findings").toBeGreaterThan(6);

    const firstCard = list.locator("[data-finding-id]").first();
    const selectedId = await firstCard.getAttribute("data-finding-id");
    await firstCard.getByRole("button").first().click();
    await expect(queue.locator(`[data-finding-id='${selectedId}']`)).toHaveAttribute(
      "data-finding-selected",
      "true",
    );

    // Selecting a finding moves to the Evidence stage; paging happens back in the queue.
    await dialog.locator("#strategic-fit-stage-findings").click();
    await queue.getByRole("button", { name: "Next findings" }).click();
    // The selection survives the page change and is disclosed rather than silently dropped.
    const note = queue.locator("[data-queue-selection-note]");
    await expect(note).toBeVisible();
    await expect(queue.locator("[data-queue-selection-announcement]")).toContainText(
      `of ${total} matching findings`,
    );
    await expect(queue.locator(`[data-finding-id='${selectedId}']`)).toHaveCount(0);

    await note.locator("[data-queue-reveal-selected]").click();
    await expect(queue.locator(`[data-finding-id='${selectedId}']`)).toHaveAttribute(
      "data-finding-selected",
      "true",
    );
    await expect(note).toHaveCount(0);

    expect(await chess(page, (api) => api.toPgn())).toBe(before);
  },
);

test(
  "expanded map and heatmap windows keep the complete list reachable inside a bounded DOM",
  {
    tag: "@engine-bound",
  },
  async ({ page }) => {
    test.slow();
    const dialog = await bootstrap(page, LARGE_REPERTOIRE, "large-report-visuals.pgn");
    const before = await chess(page, (api) => api.toPgn());

    // The strategic map is on the Overview stage; `bootstrap` lands on the queue.
    await dialog.locator("#strategic-fit-stage-overview").click();
    const map = dialog.locator(".strategic-map");
    const listTable = map.locator("[data-map-list]");
    await map.locator("[data-map-show-all-rows]").click();
    const rowsTotal = Number(await listTable.getAttribute("data-map-rows-total"));
    expect(rowsTotal).toBeGreaterThan(300);
    await expect(listTable).toHaveAttribute("data-map-rows-shown", String(rowsTotal));
    const mountedRows = Number(await listTable.getAttribute("data-map-rows-mounted"));
    expect(mountedRows).toBeLessThanOrEqual(60);
    await expect(listTable.locator("tbody tr[data-map-row]")).toHaveCount(mountedRows);

    // Scrolling reaches rows that were never mounted at the top of the list.
    const firstRoute = await listTable
      .locator("tbody tr[data-map-row]")
      .first()
      .getAttribute("data-map-row");
    await listTable.evaluate((table) => {
      const scroller = table.closest(".strategic-fit-virtual-scroll");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await expect
      .poll(
        async () =>
          await listTable.locator("tbody tr[data-map-row]").first().getAttribute("data-map-row"),
      )
      .not.toBe(firstRoute);
    await expect(listTable.locator("tbody tr[data-map-row]").count()).resolves.toBeLessThanOrEqual(
      60,
    );

    const heatmap = dialog.locator(".concept-heatmap");
    const table = heatmap.locator("[data-heatmap-table]");
    const showAll = heatmap.locator("[data-heatmap-show-all]");
    if ((await showAll.count()) > 0) {
      await showAll.click();
      await expect(heatmap).toHaveAttribute("data-heatmap-complete", "true");
    }
    const heatmapRows = Number(await table.getAttribute("data-heatmap-rows-mounted"));
    const heatmapColumns = Number(await table.getAttribute("data-heatmap-columns-mounted"));
    expect(heatmapRows).toBeLessThanOrEqual(24);
    expect(heatmapColumns).toBeLessThanOrEqual(24);
    await expect(table.locator("tbody tr[data-heatmap-row]")).toHaveCount(heatmapRows);

    expect(await chess(page, (api) => api.toPgn())).toBe(before);
  },
);
