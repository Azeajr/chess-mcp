import { expect, test, type Page } from "playwright/test";
import { openApp } from "./helpers/app";

const COMPARISON = {
  recommend: "transpose",
  basis: "eval",
  evalDelta: 15,
  fitStay: 0.51,
  fitTranspose: 0.72,
  structureStay: 0.3,
  structureTranspose: 0.4,
  eval_disagrees_with_fit: false,
};

const SUGGESTION = {
  linePath: ["d4", "d5", "Nf3", "Nf6"],
  atPath: ["d4", "d5"],
  atPly: 2,
  rerouteMove: "Nf3",
  joinsPath: ["d4", "d5", "c4"],
  savedPlies: 4,
  evalBest: 30,
  evalStay: 25,
  evalTranspose: 10,
  evalDelta: 15,
  bestSavings: true,
  bestEval: true,
  evalConfirmed: false,
};

async function openShorten(page: Page) {
  await page.evaluate(
    ({ suggestion, comparison }) => {
      const api = (
        window as unknown as {
          __chess: {
            setPruneSuggestionsForTesting: (next: unknown[]) => void;
            setInspectResultForTesting: (key: string, c: unknown, cov: unknown) => void;
          };
        }
      ).__chess;
      api.setPruneSuggestionsForTesting([suggestion]);
      const key = `${suggestion.linePath.join(",")}|${suggestion.atPly}|${suggestion.rerouteMove}`;
      api.setInspectResultForTesting(key, comparison, {
        introduces_gap: false,
        new_gaps: [],
      });
    },
    { suggestion: SUGGESTION, comparison: COMPARISON },
  );

  const shorten = page.locator("details.rep-section", { hasText: "Shorten" }).first();
  await shorten.evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  const numbers = page.locator("details.inspect-numbers").first();
  await numbers.evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
}

test("WP-029 AC-1 the idle and clean gap states are different messages", async ({ page }) => {
  await openApp(page);

  const empty = page.locator("[data-gaps-empty]");
  await expect(empty).toHaveAttribute("data-scan-state", "idle");
  const idleText = await empty.innerText();
  expect(idleText).toContain("Scan for unanswered replies");

  expect(idleText).not.toContain("No gaps found");
});

test("WP-029 AC-5 AC-7 the inspect panel leads with a verdict and keeps every number", async ({
  page,
}) => {
  await openApp(page);
  await openShorten(page);

  const verdict = page.locator("[data-inspect-verdict]");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("Take the shortcut");
  await expect(verdict).toContainText("4 plies sooner");

  const fields = page.locator("[data-inspect-field]");
  const present = await fields.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-inspect-field")),
  );
  expect(present.sort()).toEqual(
    ["basis", "evalDelta", "fitStay", "fitTranspose", "structureStay", "structureTranspose"].sort(),
  );

  await expect(page.locator("[data-inspect-field='fitStay']")).toHaveText("0.51");
  await expect(page.locator("[data-inspect-field='fitTranspose']")).toHaveText("0.72");
  await expect(page.locator("[data-inspect-field='evalDelta']")).toHaveText("0.15");
});

test("WP-029 AC-2 the error and empty states differ by text and icon under forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openApp(page);

  const empty = page.locator("[data-gaps-empty]");
  await expect(empty).toBeVisible();
  const emptyText = await empty.innerText();

  await page.evaluate(() => {
    const api = (
      window as unknown as { __chess: { setScanErrorForTesting: (msg: string) => void } }
    ).__chess;
    api.setScanErrorForTesting("engine offline");
  });

  const error = page.locator("[data-scan-state='error']");
  await expect(error).toBeVisible();
  const errorText = await error.innerText();

  expect(errorText).not.toBe(emptyText);
  expect(errorText).toContain("could not finish");

  await expect(error.locator(".scan-state-icon")).toHaveText("!");

  await expect(error.getByRole("button", { name: "Run the scan again" })).toBeVisible();
});

test("WP-029 AC-3 AC-4 each export is a single button with no second button appearing", async ({
  page,
}) => {
  await openApp(page);

  await expect(page.getByRole("button", { name: "Save CSV deck" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save annotated PGN" })).toHaveCount(0);

  const panel = page.locator(".rep-panel");
  await expect(panel.getByRole("button", { name: "Generate", exact: true })).toHaveCount(1);
});

test("WP-029 AC-5 the badge glyphs carry visible text labels", async ({ page }) => {
  await openApp(page);
  await openShorten(page);

  await expect(page.locator("[data-pick-badge='savings']")).toContainText("Most moves saved");
  await expect(page.locator("[data-pick-badge='eval']")).toContainText("Best evaluation");
});
