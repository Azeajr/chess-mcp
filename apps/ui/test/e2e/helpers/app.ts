import { expect, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  setColor(color: "white" | "black"): void;
  currentPath(): number[];
  toPgn(): string;
};

export const LONG_FILENAME = `${"long-repertoire-file-name-".repeat(5)}.pgn`;

export const RICH_PGN = [
  "1. d4 Nf6 2. Nf3 e6 3. Bf4 c5 4. e3 Nc6 5. c3 d5 6. Nbd2 Bd6 7. Bg3 O-O *",
  "1. d4 Nf6 2. Nf3 d6 3. Bf4 Nbd7 4. e3 e6 5. h3 Be7 6. Bd3 O-O 7. O-O c5 *",
  "1. d4 d5 2. Nf3 e6 3. Bf4 c5 4. e3 Nc6 5. c3 Nf6 6. Nbd2 Bd6 7. Bg3 O-O *",
  "1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Bb7 5. Bg2 Be7 6. O-O O-O 7. Nc3 d5 *",
  "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 Nc6 *",
  "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. Qc2 O-O 5. a3 Bxc3+ 6. Qxc3 d5 7. Nf3 c5 *",
  "1. d4 d5 2. c4 c6 3. Nc3 Nf6 4. e3 e6 5. Nf3 Bd6 6. Bd3 O-O 7. O-O Nbd7 *",
  "1. d4 Nf6 2. c4 g6 3. Nc3 d5 4. cxd5 Nxd5 5. e4 Nxc3 6. bxc3 Bg7 7. Nf3 c5 *",
  "1. d4 d5 2. c4 dxc4 3. Nf3 Nf6 4. e3 e6 5. Bxc4 c5 6. O-O Nc6 7. Qe2 a6 *",
  "1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. Nc3 Be7 5. Bf4 O-O 6. e3 c5 7. dxc5 Bxc5 *",
  "1. d4 d5 2. Nf3 Nf6 3. c4 e6 4. Nc3 Be7 5. Bf4 O-O 6. e3 b6 7. Bd3 Bb7 *",
  "1. d4 Nf6 2. Nf3 g6 3. c4 Bg7 4. Nc3 O-O 5. e4 d6 6. Be2 e5 7. O-O Nc6 *",
].join("\n\n");

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
