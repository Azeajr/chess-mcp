import { expect, test } from "playwright/test";
import { openApp } from "./helpers/app";
import { keyboardReachable } from "./helpers/accessibility";

test.fixme("UX-003 UX-004 board, move tree, and repertoire controls are keyboard reachable", async ({
  page,
}) => {
  await openApp(page);
  const app = page.locator(".app");
  expect(await keyboardReachable(app, ".cg-wrap")).toEqual([]);
  expect(await keyboardReachable(app, ".moves")).toEqual([]);
  expect(await keyboardReachable(app, ".rep-row")).toEqual([]);
});
