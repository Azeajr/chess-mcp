import { expect, test, type Locator, type Page } from "playwright/test";
import { openApp } from "./helpers/app";
import { basicAccessibilityViolations, touchTargetViolations } from "./helpers/accessibility";

type ChessHarness = {
  currentPath(): number[];
  goto(path: number[]): void;
  selectStrategicFitProfile(mode: "balanced"): unknown;
  setStrategicFitWorkspaceRegionState(
    region: "overview" | "findings" | "evidence" | "resolution",
    state: { status: "loading"; message: string },
  ): void;
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

async function expectFocusRing(locator: Locator) {
  await locator.focus();
  expect(
    await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.outlineWidth,
        style: style.outlineStyle,
        offset: style.outlineOffset,
        color: style.outlineColor,
        accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      };
    }),
  ).toEqual({
    width: "2px",
    style: "solid",
    offset: "2px",
    color: "rgb(110, 168, 254)",
    accent: "#6ea8fe",
  });
}

test("WP-006 AC-1 gives keyboard focus a global two-pixel accent ring", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  const samples = [
    page.getByRole("button", { name: "Open PGN" }),
    page.getByRole("button", { name: "Save", exact: true }),
    page.locator(".topbar select"),
    page.getByLabel("Analysis depth slider"),
    page.locator(".rep-section > summary").first(),
    page.locator(".rep-panel .scan-btn").first(),
    page.locator(".chat-mode"),
    page.getByRole("button", { name: "Clear" }),
    page.locator(".chat-input textarea"),
    page.getByRole("button", { name: "Open workspace" }),
  ];
  for (const sample of samples) await expectFocusRing(sample);
});

test("WP-006 AC-2 reduced motion disables board and CSS motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page, { width: 1280, height: 800 });
  await chess(page, (api) =>
    api.setStrategicFitWorkspaceRegionState("overview", {
      status: "loading",
      message: "Motion policy fixture",
    }),
  );
  await chess(page, (api) => api.goto([0]));
  await expect.poll(() => chess(page, (api) => api.currentPath())).toEqual([0]);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const transforms = async () =>
    page
      .locator(".cg-wrap piece")
      .evaluateAll((pieces) => pieces.map((piece) => getComputedStyle(piece).transform).sort());
  const settledImmediately = await transforms();
  await page.waitForTimeout(160);
  expect(await transforms()).toEqual(settledImmediately);

  for (const selector of [".divider", ".eval-bar .fill", ".ui-region-spinner"]) {
    const probe = page.locator(selector).first();
    if ((await probe.count()) === 0) {
      await page.locator(".app-main").evaluate(
        (root, className) => {
          const element = document.createElement("span");
          element.className = className;
          root.append(element);
        },
        selector.slice(1).replaceAll(" .", " "),
      );
    }
    const style = await page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          animationName: computed.animationName,
          transitionDuration: computed.transitionDuration,
        };
      });
    expect(style.transitionDuration).toBe("0s");
    expect(style.animationName).toBe("none");
  }
});

test("WP-006 AC-3 forced colors retain non-color status distinctions", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openApp(page, { width: 390, height: 844 });
  await page.locator(".app-main").evaluate((root) => {
    const fixture = document.createElement("div");
    fixture.innerHTML = `
      <span class="sev sev-high">high</span><span class="sev sev-medium">medium</span>
      <span class="fit fit-in-book">book</span><span class="fit fit-out">out</span>
      <div class="mobile-tabs" style="display: flex"><button class="active">Moves</button></div>
      <progress class="ui-progress" max="100" value="50"></progress>`;
    root.append(fixture);
  });

  expect(await page.locator(".sev-high").evaluate((el) => getComputedStyle(el).borderStyle)).toBe(
    "double",
  );
  expect(await page.locator(".sev-medium").evaluate((el) => getComputedStyle(el).borderStyle)).toBe(
    "dashed",
  );
  expect(
    await page.locator(".fit-in-book").evaluate((el) => getComputedStyle(el).borderStyle),
  ).toBe("solid");
  expect(await page.locator(".fit-out").evaluate((el) => getComputedStyle(el).borderStyle)).toBe(
    "double",
  );
  await expect(page.getByRole("button", { name: "Moves" })).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  expect(
    await page.locator(".ui-progress").evaluate((el) => getComputedStyle(el).borderTopWidth),
  ).not.toBe("0px");
});

test("WP-006 AC-4 and AC-5 analysis text is copyable but the board is not selectable", async ({
  browserName,
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  const selectors = [
    ".result-card",
    ".chat-log .msg",
    ".analysis .line",
    ".rep-row",
    ".chat-error",
    ".strategic-fit-evidence",
  ];
  await page.locator(".app-main").evaluate((root) => {
    const fixture = document.createElement("div");
    fixture.innerHTML = `
      <div class="result-card">Selectable .result-card</div>
      <div class="chat-log"><div class="msg">Selectable .chat-log .msg</div></div>
      <div class="analysis"><div class="line">Selectable .analysis .line</div></div>
      <div class="rep-row">Selectable .rep-row</div>
      <div class="chat-error">Selectable .chat-error</div>
      <div class="strategic-fit-evidence">Selectable .strategic-fit-evidence</div>`;
    root.append(fixture);
  });

  for (const selector of selectors) {
    expect(
      await page
        .locator(selector)
        .last()
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          const style = getComputedStyle(element);
          return {
            text: selection?.toString(),
            selectable:
              style.getPropertyValue("user-select") !== "none" &&
              style.getPropertyValue("-webkit-user-select") !== "none",
          };
        }),
    ).toEqual({ text: `Selectable ${selector}`, selectable: true });
  }

  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  await page.locator(".app-main").evaluate((root, value) => {
    const element = document.createElement("div");
    element.dataset.copyFen = "";
    element.textContent = value;
    root.append(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand = () => {
      throw new Error("legacy copy path used");
    };
  }, fen);
  if (browserName !== "webkit") {
    const copied = page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            "copy",
            () => resolve(window.getSelection()?.toString() ?? ""),
            { once: true },
          );
        }),
    );
    await page.keyboard.press("ControlOrMeta+C");
    expect(await copied).toBe(fen);
  } else {
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(fen);
  }

  expect(
    await page.locator(".cg-wrap").evaluate((element) => {
      const style = getComputedStyle(element);
      return style.getPropertyValue("user-select") || style.getPropertyValue("-webkit-user-select");
    }),
  ).toBe("none");
});

test("WP-006 AC-6 touch-emulated board dragging remains enabled without callouts", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Playwright exposes raw touch-drag dispatch in Chromium");
  const context = await page
    .context()
    .browser()!
    .newContext({
      baseURL: "http://127.0.0.1:4173",
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
  const touchPage = await context.newPage();
  const cdp = await context.newCDPSession(touchPage);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await touchPage.goto("/");
  await expect.poll(() => chess(touchPage, (api) => Boolean(api))).toBe(true);
  await chess(touchPage, (api) =>
    (
      api as ChessHarness & {
        loadPgn(pgn: string, name: string): void;
      }
    ).loadPgn("1. e4 e5 *", "touch-drag.pgn"),
  );
  const board = touchPage.locator(".cg-wrap");
  await expect.poll(async () => (await board.locator("piece").count()) >= 32).toBe(true);
  await touchPage.waitForTimeout(250);
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const square = box!.width / 8;
  const source = { x: box!.x + 4.5 * square, y: box!.y + 6.5 * square };
  const target = { x: box!.x + 4.5 * square, y: box!.y + 4.5 * square };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...source, id: 1, force: 1, radiusX: 2, radiusY: 2 }],
  });
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: source.x + ((target.x - source.x) * step) / 8,
          y: source.y + ((target.y - source.y) * step) / 8,
          id: 1,
          force: 1,
          radiusX: 2,
          radiusY: 2,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => chess(touchPage, (api) => api.currentPath())).toEqual([0]);
  await expect(board).toHaveCSS("user-select", "none");
  await context.close();
});

test("WP-006 AC-7 every app control meets pointer and touch target floors", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  expect(await touchTargetViolations(page.locator(".app-main"), 24)).toEqual([]);

  const context = await page
    .context()
    .browser()!
    .newContext({
      baseURL: "http://127.0.0.1:4173",
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });
  const touchPage = await context.newPage();
  await openApp(touchPage, { width: 1280, height: 800 });
  expect(await touchTargetViolations(touchPage.locator(".app-main"), 44)).toEqual([]);
  await context.close();
});

test("WP-006 AC-8 target floors keep panel density within fifteen percent", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  const baseline = { side: 717.625, chat: 717.625 };
  const heights = await page.locator(".side-panel, .chat-wrap").evaluateAll((elements) => ({
    side: elements[0]!.getBoundingClientRect().height,
    chat: elements[1]!.getBoundingClientRect().height,
  }));
  expect(heights.side).toBeLessThanOrEqual(baseline.side * 1.15);
  expect(heights.chat).toBeLessThanOrEqual(baseline.chat * 1.15);
});

test("WP-036 AC-2 and AC-6 rendered body type meets its floor without panel overgrowth", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });

  const violations = await page.locator("body").evaluate((root) =>
    [...root.querySelectorAll("*")]
      .filter((element) => !element.closest("svg, .cg-wrap"))
      .filter((element) => element.textContent?.trim())
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => ({
        selector: element.className || element.tagName.toLowerCase(),
        size: Number.parseFloat(getComputedStyle(element).fontSize),
        uppercase: getComputedStyle(element).textTransform === "uppercase",
      }))
      .filter(({ size, uppercase }) => size < (uppercase ? 11.2 : 12)),
  );
  expect(violations).toEqual([]);

  const baseline = { side: 717.625, chat: 717.625 };
  const heights = await page.locator(".side-panel, .chat-wrap").evaluateAll((elements) => ({
    side: elements[0]!.getBoundingClientRect().height,
    chat: elements[1]!.getBoundingClientRect().height,
  }));
  expect(heights.side).toBeLessThanOrEqual(baseline.side * 1.15);
  expect(heights.chat).toBeLessThanOrEqual(baseline.chat * 1.15);
});

test("WP-037 AC-5 presentation primitives keep panels within ten percent of WP-036", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  const baseline = { side: 717.625, chat: 717.625 };
  const heights = await page.locator(".side-panel, .chat-wrap").evaluateAll((elements) => ({
    side: elements[0]!.getBoundingClientRect().height,
    chat: elements[1]!.getBoundingClientRect().height,
  }));
  expect(heights.side).toBeLessThanOrEqual(baseline.side * 1.1);
  expect(heights.chat).toBeLessThanOrEqual(baseline.chat * 1.1);
});

test("WP-037 AC-7 migrated presentation surfaces have no basic accessibility violations", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  expect(await basicAccessibilityViolations(page.locator(".app-main"))).toEqual([]);

  await page.getByRole("button", { name: "Open workspace" }).click();
  const workspace = page.getByRole("dialog", { name: "Strategic Fit" });
  await expect(workspace).toBeVisible();
  expect(await basicAccessibilityViolations(workspace)).toEqual([]);
});
