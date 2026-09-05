import { expect, type Locator } from "playwright/test";

type Square = string;

interface Point {
  readonly x: number;
  readonly y: number;
}

const boardElement = (board: Locator) => board.locator("cg-board");

async function boardOrientation(board: Locator): Promise<"white" | "black"> {
  await expect(board).toHaveClass(/orientation-(white|black)/u);
  return ((await board.getAttribute("class")) ?? "").includes("orientation-black")
    ? "black"
    : "white";
}

async function centres(board: Locator, keys: readonly Square[]): Promise<Point[]> {
  const element = boardElement(board);
  await element.waitFor();
  const input = { keys, asWhite: (await boardOrientation(board)) === "white" };

  await element.evaluate((node: Element, { keys: squares, asWhite }) => {
    const points = () => {
      const box = node.getBoundingClientRect();
      return squares.map((key) => {
        let file = key.charCodeAt(0) - 97;
        let rank = key.charCodeAt(1) - 49;
        if (!asWhite) {
          file = 7 - file;
          rank = 7 - rank;
        }
        return {
          x: box.left + (box.width * file) / 8 + box.width / 16,
          y: box.top + (box.height * (7 - rank)) / 8 + box.height / 16,
        };
      });
    };
    const escapes = (box: { left: number; top: number; right: number; bottom: number }) =>
      points().some(
        (p) =>
          p.x < box.left + 4 || p.x > box.right - 4 || p.y < box.top + 4 || p.y > box.bottom - 4,
      );
    const centroid = () => {
      const all = points();
      return {
        x: all.reduce((sum, p) => sum + p.x, 0) / all.length,
        y: all.reduce((sum, p) => sum + p.y, 0) / all.length,
      };
    };

    for (let cur = node.parentElement; cur; cur = cur.parentElement) {
      const box = cur.getBoundingClientRect();
      if (!escapes(box)) continue;
      const style = getComputedStyle(cur);
      if (/(auto|scroll|overlay)/u.test(style.overflowY) && cur.scrollHeight > cur.clientHeight)
        cur.scrollTop += centroid().y - (box.top + box.height / 2);
      if (/(auto|scroll|overlay)/u.test(style.overflowX) && cur.scrollWidth > cur.clientWidth)
        cur.scrollLeft += centroid().x - (box.left + box.width / 2);
    }

    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    if (escapes(viewport)) {
      const point = centroid();
      window.scrollBy(point.x - window.innerWidth / 2, point.y - window.innerHeight / 2);
    }
  }, input);

  await board.page().evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      ),
  );

  const measured = await element.evaluate((node: Element, { keys: squares, asWhite }) => {
    const describe = (el: Element) => {
      const classes = typeof el.className === "string" ? el.className.trim() : "";
      return (
        el.tagName.toLowerCase() + (classes === "" ? "" : `.${classes.split(/\s+/u).join(".")}`)
      );
    };
    const box = node.getBoundingClientRect();
    return squares.map((key) => {
      let file = key.charCodeAt(0) - 97;
      let rank = key.charCodeAt(1) - 49;
      if (!asWhite) {
        file = 7 - file;
        rank = 7 - rank;
      }
      const x = box.left + (box.width * file) / 8 + box.width / 16;
      const y = box.top + (box.height * (7 - rank)) / 8 + box.height / 16;
      const hit = document.elementFromPoint(x, y);
      return {
        key,
        x,
        y,
        onBoard: hit !== null && node.contains(hit),
        hit: hit === null ? "nothing — the point is outside the viewport" : describe(hit),
      };
    });
  }, input);

  const missed = measured.filter((square) => !square.onBoard);
  if (missed.length > 0) {
    const detail = missed
      .map((s) => `${s.key} at (${Math.round(s.x)}, ${Math.round(s.y)}) hit ${s.hit}`)
      .join("; ");
    throw new Error(
      `Chessground square centres are not hittable, so real input cannot reach the board: ${detail}. ` +
        "The board is most likely clipped by a scroll container smaller than itself, or covered by " +
        "an overlay — give the test a viewport tall enough for the squares in play.",
    );
  }

  return measured.map(({ x, y }) => ({ x, y }));
}

export async function dragMove(board: Locator, orig: Square, dest: Square): Promise<void> {
  const [from, to] = await centres(board, [orig, dest]);
  const mouse = board.page().mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  await expect(boardElement(board).locator("piece.dragging")).toHaveCount(1);
  await mouse.move(to.x, to.y, { steps: 8 });
  await mouse.up();
}

export async function clickMove(board: Locator, orig: Square, dest: Square): Promise<void> {
  const [from, to] = await centres(board, [orig, dest]);
  const mouse = board.page().mouse;
  await mouse.click(from.x, from.y);
  await expect(boardElement(board).locator("square.selected")).toHaveCount(1);
  await mouse.click(to.x, to.y);
}

export async function tapMove(board: Locator, orig: Square, dest: Square): Promise<void> {
  const [from, to] = await centres(board, [orig, dest]);
  const touchscreen = board.page().touchscreen;
  await touchscreen.tap(from.x, from.y);
  await touchscreen.tap(to.x, to.y);
}

export async function selectSquare(board: Locator, key: Square): Promise<void> {
  const [point] = await centres(board, [key]);
  await board.page().mouse.click(point.x, point.y);
  await expect(boardElement(board).locator("square.selected")).toHaveCount(1);
}

const squaresClassed = (board: Locator, className: string): Promise<string[]> =>
  boardElement(board).evaluate(
    (node: Element, selector: string) =>
      [...node.querySelectorAll(selector)].map(
        (square) => (square as { cgKey?: string }).cgKey ?? "",
      ),
    `square.${className}`,
  );

export const destinationSquares = (board: Locator): Promise<string[]> =>
  squaresClassed(board, "move-dest");

export const premoveSquares = (board: Locator): Promise<string[]> =>
  squaresClassed(board, "premove-dest");

export const pieceAt = (board: Locator, key: Square): Promise<string | null> =>
  boardElement(board).evaluate(
    (node: Element, square: string) =>
      [...node.querySelectorAll("piece")]
        .filter((piece) => (piece as { cgKey?: string }).cgKey === square)
        .map((piece) => piece.className.replace(/\s+/gu, " ").trim())[0] ?? null,
    key,
  );
