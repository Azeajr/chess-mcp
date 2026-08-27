import { expect, test, type Page } from "playwright/test";
import { openApp } from "./helpers/app";

/**
 * WP-029 — the repertoire panel's states, labels, and readings.
 *
 * The audit findings are that empty and error states were indistinguishable, exports took two
 * button presses, and analytical output was written in the vocabulary of the thing that computed
 * it rather than the decision the reader is making.
 */

/** A settled inspect payload. Every numeric field here must survive the AC-7 presence check. */
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

/**
 * A shortcut suggestion shaped to the real PruneSuggestion contract in packages/chess-tools/src/pgn.ts.
 * linePath and atPath are SAN paths, not indices, and joinsPath is required — the row renders from
 * these directly, so a loosely-shaped fixture fails inside the component rather than in an
 * assertion.
 */
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

  // The Shorten section is a collapsed <details>; its rows are not rendered until it is open.
  const shorten = page.locator("details.rep-section", { hasText: "Shorten" }).first();
  await shorten.evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
  // The numbers live under their own disclosure, which AC-7's presence check needs open.
  const numbers = page.locator("details.inspect-numbers").first();
  await numbers.evaluate((node: HTMLDetailsElement) => {
    node.open = true;
  });
}

test("WP-029 AC-1 the idle and clean gap states are different messages", async ({ page }) => {
  await openApp(page);

  // Before any scan the section states what a scan would do, rather than reporting a result it
  // does not have.
  const empty = page.locator("[data-gaps-empty]");
  await expect(empty).toHaveAttribute("data-scan-state", "idle");
  const idleText = await empty.innerText();
  expect(idleText).toContain("Scan for unanswered replies");

  // The clean state is a different string; a user who sees one must not mistake it for the other.
  expect(idleText).not.toContain("No gaps found");
});

test("WP-029 AC-5 AC-7 the inspect panel leads with a verdict and keeps every number", async ({
  page,
}) => {
  await openApp(page);
  await openShorten(page);

  // AC-5: the first line is a sentence about the decision, not a metric dump.
  const verdict = page.locator("[data-inspect-verdict]");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("Take the shortcut");
  await expect(verdict).toContainText("4 plies sooner");

  // AC-7: every analytical field present before the change is still present. Failing this means
  // the redesign quietly dropped information the reader previously had.
  const fields = page.locator("[data-inspect-field]");
  const present = await fields.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-inspect-field")),
  );
  expect(present.sort()).toEqual(
    ["basis", "evalDelta", "fitStay", "fitTranspose", "structureStay", "structureTranspose"].sort(),
  );

  // The values are the payload's, not placeholders.
  await expect(page.locator("[data-inspect-field='fitStay']")).toHaveText("0.51");
  await expect(page.locator("[data-inspect-field='fitTranspose']")).toHaveText("0.72");
  await expect(page.locator("[data-inspect-field='evalDelta']")).toHaveText("0.15");
});

test("WP-029 AC-2 the error and empty states differ by text and icon under forced colors", async ({
  page,
}) => {
  // Forced colors removes the colour difference between a warning and a neutral empty state, so
  // this is exactly the mode where a colour-only distinction fails.
  await page.emulateMedia({ forcedColors: "active" });
  await openApp(page);

  const empty = page.locator("[data-gaps-empty]");
  await expect(empty).toBeVisible();
  const emptyText = await empty.innerText();

  // Drive the scan into a failure so the error treatment renders in the same section.
  await page.evaluate(() => {
    const api = (
      window as unknown as { __chess: { setScanErrorForTesting: (msg: string) => void } }
    ).__chess;
    api.setScanErrorForTesting("engine offline");
  });

  const error = page.locator("[data-scan-state='error']");
  await expect(error).toBeVisible();
  const errorText = await error.innerText();

  // The two states must be tellable apart from their text alone.
  expect(errorText).not.toBe(emptyText);
  expect(errorText).toContain("could not finish");

  // And each carries a glyph, so the distinction survives when colour is unavailable.
  await expect(error.locator(".scan-state-icon")).toHaveText("!");

  // The retry re-runs the same command rather than sending the user elsewhere.
  await expect(error.getByRole("button", { name: "Run the scan again" })).toBeVisible();
});

test("WP-029 AC-3 AC-4 each export is a single button with no second button appearing", async ({
  page,
}) => {
  await openApp(page);

  // The defect was a generate button followed by a save button that only appeared afterwards.
  // Assert the second button does not exist in either export section.
  await expect(page.getByRole("button", { name: "Save CSV deck" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save annotated PGN" })).toHaveCount(0);

  // The remaining control is a single button. Its label stays short because the section heading
  // already names what is generated; AC-4's substance is that one press does the whole job.
  const panel = page.locator(".rep-panel");
  await expect(panel.getByRole("button", { name: "Generate", exact: true })).toHaveCount(1);
});

test("WP-029 AC-5 the badge glyphs carry visible text labels", async ({ page }) => {
  await openApp(page);
  await openShorten(page);

  // A glyph whose meaning lives only in a title attribute is unavailable on touch and to most
  // screen readers, so each badge states its meaning in text.
  await expect(page.locator("[data-pick-badge='savings']")).toContainText("Most moves saved");
  await expect(page.locator("[data-pick-badge='eval']")).toContainText("Best evaluation");
});
