import { expect, test, type Page } from "playwright/test";
import {
  contrastViolations,
  expectBasicAccessibility,
  touchTargetViolations,
} from "./helpers/accessibility";

type ChessHarness = {
  strategicFitMetadataStatus(): string;
  selectStrategicFitProfile(mode: "balanced"): unknown;
  setStrategicFitWorkspaceRegionState(
    region: "overview" | "findings" | "evidence" | "resolution",
    state: { status: "empty" | "loading" | "error"; message?: string },
  ): void;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

async function openWorkspace(page: Page, setupComplete = false) {
  if (setupComplete) await chess(page, (api) => api.selectStrategicFitProfile("balanced"));
  const opener = page.getByRole("button", { name: "Open workspace" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(dialog).toBeVisible();
  return { dialog, opener };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
});

test("first-run setup has a coherent accessible outline and returns focus to analysis", async ({ page }) => {
  const { dialog } = await openWorkspace(page);
  await expectBasicAccessibility(dialog);
  expect(await contrastViolations(dialog)).toEqual([]);

  const close = dialog.getByRole("button", { name: "Return to repertoire" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: /Balanced/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByText("Advanced preferences", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Skip for now" })).toBeFocused();
  await page.keyboard.press("Tab");
  const submit = dialog.getByRole("button", { name: "Use Balanced profile" });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Analyze strategic fit" })).toBeFocused();
  await expectBasicAccessibility(dialog);
});

test("phone stage tabs support keyboard navigation and every touch action is at least 44px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog } = await openWorkspace(page, true);
  const overview = dialog.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Findings" })).toBeFocused();
  await expect(dialog.getByRole("tab", { name: "Findings" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator("#strategic-fit-pane-findings")).toHaveAttribute("role", "tabpanel");
  await page.keyboard.press("End");
  await expect(dialog.getByRole("tab", { name: "Resolution" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overview).toBeFocused();
  await expect(dialog.locator(".strategic-fit-workspace-pane:visible")).toHaveCount(1);

  await expectBasicAccessibility(dialog);
  expect(await touchTargetViolations(dialog)).toEqual([]);
  expect(await contrastViolations(dialog)).toEqual([]);
});

test("reduced-motion preference disables workspace animation and transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { dialog } = await openWorkspace(page, true);
  await chess(page, (api) => api.setStrategicFitWorkspaceRegionState("overview", {
    status: "loading",
    message: "Reduced-motion loading fixture.",
  }));
  const spinner = dialog.locator(".strategic-fit-region-spinner");
  await expect(spinner).toBeVisible();
  expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await dialog.evaluate((element) => [...element.querySelectorAll("*")].every((child) => {
    const style = getComputedStyle(child);
    return style.animationDuration === "0s" && style.transitionDuration === "0s";
  }))).toBe(true);
});
