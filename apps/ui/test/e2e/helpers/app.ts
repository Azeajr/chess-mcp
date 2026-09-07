import { expect, type Page } from "playwright/test";
import { readFileSync } from "node:fs";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  setColor(color: "white" | "black"): void;
  currentPath(): number[];
  goto(path: number[]): void;
  toPgn(): string;
};

export const LONG_FILENAME = `${"long-repertoire-file-name-".repeat(5)}.pgn`;

export const RICH_PGN = readFileSync(
  new URL("../../fixtures/ux-review/rich-repertoire.pgn", import.meta.url),
  "utf8",
).trim();

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

export async function openApp(
  page: Page,
  options: {
    width?: number;
    height?: number;
    pgn?: string;
    fileName?: string;
    color?: "white" | "black";
  } = {},
): Promise<void> {
  const {
    width,
    height,
    pgn = RICH_PGN,
    fileName = "rich-repertoire.pgn",
    color = "white",
  } = options;
  if (width && height) await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(
    page,
    (api, input) => {
      api.loadPgn(input.pgn, input.fileName);
      api.setColor(input.color);
    },
    { pgn, fileName, color },
  );
}

export const currentPath = (page: Page) => chess(page, (api) => api.currentPath());
export const currentPgn = (page: Page) => chess(page, (api) => api.toPgn());

export const goToPath = (page: Page, path: number[]) =>
  chess(page, (api, next) => api.goto(next), path);
