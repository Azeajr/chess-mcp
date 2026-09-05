import { expect, test } from "playwright/test";
import { openApp } from "./helpers/app";
import { touchTargetViolations } from "./helpers/accessibility";

const COMMAND_TOOLS = [
  { command: "audit_repertoire_moves", action: "Audit", expectedArgs: { depth: 20 } },
  {
    command: "find_only_moves",
    action: "Find",
    expectedArgs: { max_positions: 60, depth: 20 },
  },
  { command: "find_structures", action: "Search", expectedArgs: { structure: "" } },
  { command: "prep_vs_opponent", action: "Prepare", expectedArgs: { username: "" } },
  {
    command: "export_annotated_repertoire",
    action: "Generate",
    expectedArgs: { max_positions: 60, depth: 20 },
  },
] as const;

const SCAN_TOOLS = ["Gaps", "Connect", "Shorten", "Extend here"] as const;

const repertoirePanel = (page: import("playwright/test").Page) => page.locator(".rep-panel");

test("WP-022 AC-2 every tool control is present and reachable", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  const panel = repertoirePanel(page);

  for (const { action } of COMMAND_TOOLS) {
    await expect(
      panel.getByRole("button", { name: action, exact: true }),
      `${action} control is present`,
    ).toHaveCount(1);
  }

  for (const name of SCAN_TOOLS) {
    await expect(panel.getByText(name, { exact: true }).first()).toBeVisible();
  }
});

test("WP-022 AC-2 each tool records the same command with the same arguments", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  const panel = repertoirePanel(page);

  for (const { command, action, expectedArgs } of COMMAND_TOOLS) {
    await panel.getByRole("button", { name: action, exact: true }).click();

    const recorded = await page.evaluate(() =>
      (
        window as unknown as {
          __chess: {
            lastDirectCommandRequest: () => {
              command: string;
              args: Record<string, unknown>;
            } | null;
          };
        }
      ).__chess.lastDirectCommandRequest(),
    );
    expect(recorded?.command, `${command} was dispatched`).toBe(command);
    expect(recorded?.args, `${command} retained its exact arguments`).toEqual(expectedArgs);
  }
});

test("WP-022 AC-3 the canonical depth statement appears exactly once", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  const panel = repertoirePanel(page);

  const canonicalDepths = await panel
    .locator(".scope-note:has-text('Engine-backed operations')")
    .evaluate((element) => [...(element.textContent ?? "").matchAll(/\bdepth\b/giu)].length);
  expect(canonicalDepths, "the canonical depth line states its analysis depth once").toBe(1);
});

test("WP-022 AC-5 group summaries are keyboard operable and report their state", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  const panel = repertoirePanel(page);

  const summaries = panel.locator("summary");
  const count = await summaries.count();
  expect(count, "the panel groups its tools").toBeGreaterThan(0);

  const first = summaries.first();
  await first.focus();
  await expect(first).toBeFocused();

  const openState = () =>
    first.evaluate((element) => element.closest("details")?.hasAttribute("open") ?? false);
  const before = await openState();
  await page.keyboard.press("Enter");
  expect(await openState(), "Enter toggles the group").toBe(!before);
  await page.keyboard.press("Enter");
  expect(await openState(), "Enter toggles it back").toBe(before);
});

test("WP-022 AC-6 panel controls meet the pointer target minimum", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  expect(await touchTargetViolations(repertoirePanel(page), 24)).toEqual([]);
});

test("WP-022 AC-1 exactly four groups with the agreed titles and no Advanced label", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  const panel = repertoirePanel(page);

  const groupTitles = await panel
    .locator(".rep-group")
    .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")));
  expect(groupTitles).toEqual(["Analyze", "Prepare", "Generate", "Improve"]);

  await expect(panel.getByText("Advanced", { exact: true })).toHaveCount(0);
});

test("WP-022 AC-4 a collapsed group with a result shows a count and a relative time", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  const panel = repertoirePanel(page);

  await page.evaluate(() => {
    type Harness = {
      __chess: {
        setCommandStateForTesting: (command: string, state: unknown) => void;
      };
    };
    const api = (window as unknown as Harness).__chess;
    api.setCommandStateForTesting("audit_repertoire_moves", {
      status: "completed",
      completedAt: Date.now(),
      result: {
        color: "white",
        positions_scanned: 4,
        moves_audited: 4,
        findings: [
          {
            path: ["e4", "e5"],
            prescribed: "Nf3",
            best_move: "Nf3",
            cp_loss: 0,
            classification: "ok",
          },
          {
            path: ["d4", "d5"],
            prescribed: "c4",
            best_move: "c4",
            cp_loss: 10,
            classification: "ok",
          },
          { path: ["c4"], prescribed: "Nf3", best_move: "Nf3", cp_loss: 20, classification: "ok" },
        ],
      },
    });
  });

  const summary = panel.locator(".rep-group[aria-label='Analyze'] > details > summary").first();
  const note = summary.locator(".rep-summary-note");
  await expect(note, "the settled summary appears in the collapsed group").toBeVisible();
  const summaryText = (await note.textContent()) ?? "";
  expect(summaryText, "a result count").toMatch(/\d/);
  expect(summaryText.toLowerCase(), "a relative completion time").toMatch(/now|ago/u);
});

test("WP-022 AC-7 collapsed panel height does not exceed today's all-collapsed height", async ({
  page,
  browserName,
}) => {
  await openApp(page, { width: 1280, height: 800 });

  const BASELINES = { chromium: 714.5, firefox: 713.5, webkit: 733.6 } as const;
  await repertoirePanel(page)
    .locator("details[open] > summary")
    .evaluateAll((summaries) => {
      for (const summary of summaries) summary.closest("details")?.removeAttribute("open");
    });
  const height = await repertoirePanel(page).evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(height, `${browserName} collapsed panel height`).toBeLessThanOrEqual(
    BASELINES[browserName],
  );
});
