/**
 * Driving a chessground board from Playwright.
 *
 * Two facts about chessground 9.2 shape everything here, and both are read from its source rather
 * than assumed, because guessing at either one produces a board that silently does not move.
 *
 * It binds `mousedown`/`touchstart` on its board element and `mousemove`/`mouseup` on the document
 * (`events.ts`) — no pointer handlers at all, so a dispatched `pointerdown` reaches nothing. And
 * `drag.start` returns immediately unless `e.isTrusted || state.trustAllEvents`, which this app
 * never enables, so a hand-built `MouseEvent` is dropped just as quietly. Real Playwright input is
 * the only thing that gets through, which is why every gesture below goes through `page.mouse` or
 * `page.touchscreen`.
 *
 * Real input is delivered at *viewport* coordinates, and that is what makes this a helper rather
 * than three lines in a spec. The app's main board is comfortably on screen, but the Strategic Fit
 * drill board is not: `.strategic-fit-resolution-pane` scrolls a 352px board inside a 215px box, so
 * a square's centre routinely falls outside the viewport entirely. The click then lands on nothing,
 * `document.elementFromPoint` there returns `null`, and no part of the board reports a problem.
 * `scrollIntoViewIfNeeded` does not rescue it either — the board is taller than its own scroll
 * viewport, so "fully in view" is never true of it.
 *
 * So each entry point scrolls only when a square it is about to touch is unreachable, centres it
 * when it does scroll (a point nudged to the very edge of a clipping ancestor is inside the
 * viewport and still not hittable), re-measures afterwards, and asserts the point really lands on
 * the board before dispatching. A miss then fails naming the element that got in the way, instead
 * of leaving a board that just did not move.
 */
import { expect, type Locator } from "playwright/test";

/** A square in algebraic notation, e.g. `"e2"`. */
type Square = string;

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * `cg-board` is the element chessground measures for `state.dom.bounds` and binds `mousedown` to,
 * so it — not the `.cg-wrap` a caller passes — is the box every coordinate here is derived from.
 */
const boardElement = (board: Locator) => board.locator("cg-board");

/** Chessground writes the orientation onto the wrap as a class; it is the only reliable source. */
async function boardOrientation(board: Locator): Promise<"white" | "black"> {
  await expect(board).toHaveClass(/orientation-(white|black)/u);
  return ((await board.getAttribute("class")) ?? "").includes("orientation-black")
    ? "black"
    : "white";
}

/**
 * Scroll the given squares into reach if they are not already, then return their viewport centres.
 */
async function centres(board: Locator, keys: readonly Square[]): Promise<Point[]> {
  const element = boardElement(board);
  await element.waitFor();
  const input = { keys, asWhite: (await boardOrientation(board)) === "white" };

  await element.evaluate((node: Element, { keys: squares, asWhite }) => {
    // Chessground's own `computeSquareCenter` (util.ts), which is what its hit testing inverts.
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

  // Chessground memoises `state.dom.bounds` and clears it from a `scroll` listener
  // (`bindDocument`), and browsers dispatch `scroll` on the frame after the scroll rather than
  // synchronously. Measuring — or clicking — before that lands would have chessground map a
  // perfectly good viewport coordinate through a stale board box and resolve the wrong square.
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

/**
 * Play `orig`→`dest` by dragging, the gesture a mouse user actually makes.
 *
 * `draggable.autoDistance` plus a desktop `stats.dragged` default means chessground treats the drag
 * as started from the first `mousedown`, so no minimum travel is required — but the intermediate
 * `mousemove`s are sent anyway, because they are what a real drag produces and what `drag.move`
 * consumes to track the piece.
 */
export async function dragMove(board: Locator, orig: Square, dest: Square): Promise<void> {
  const [from, to] = await centres(board, [orig, dest]);
  const mouse = board.page().mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  // Chessground marks the dragged piece synchronously inside its own `mousedown` handler, so this
  // both waits for and proves that the press reached the board rather than something in front of it.
  await expect(boardElement(board).locator("piece.dragging")).toHaveCount(1);
  await mouse.move(to.x, to.y, { steps: 8 });
  await mouse.up();
}

/** Play `orig`→`dest` by clicking the piece and then its destination. */
export async function clickMove(board: Locator, orig: Square, dest: Square): Promise<void> {
  const [from, to] = await centres(board, [orig, dest]);
  const mouse = board.page().mouse;
  await mouse.click(from.x, from.y);
  await expect(boardElement(board).locator("square.selected")).toHaveCount(1);
  await mouse.click(to.x, to.y);
}

/**
 * Play `orig`→`dest` with two real touches. Requires a `hasTouch` context.
 *
 * Two taps rather than a synthesised drag, because `touchscreen.tap()` is the only touch primitive
 * Playwright exposes — and that is enough: chessground's touch `start()` calls the exact same
 * `board.selectSquare()` a click does, synchronously, on `touchstart` alone, so a tap on a piece
 * selects it and a second tap completes it. A hand-built `new TouchEvent(...)` is not an option for
 * the `isTrusted` reason at the top of this file; that was run against this app first, and
 * chessground's `start()` returned immediately on every engine, with WebKit additionally rejecting
 * the `Touch` constructor outright ("Illegal constructor"). A drag would not start either:
 * `stats.dragged` defaults to `false` when `ontouchstart` exists, which is chessground's own "on a
 * touchscreen, default to tap-tap moves" behaviour rather than something to route around.
 */
export async function tapMove(board: Locator, orig: Square, dest: Square): Promise<void> {
  const [from, to] = await centres(board, [orig, dest]);
  const touchscreen = board.page().touchscreen;
  await touchscreen.tap(from.x, from.y);
  await touchscreen.tap(to.x, to.y);
}

/**
 * Click one square without following it with a destination, leaving the board mid-selection.
 *
 * Chessground marks `state.selected` synchronously but paints the selection and its destination
 * markers in the redraw that follows, so this waits for that paint — otherwise the very next read
 * of `destinationSquares` sees the board as it was before the click.
 */
export async function selectSquare(board: Locator, key: Square): Promise<void> {
  const [point] = await centres(board, [key]);
  await board.page().mouse.click(point.x, point.y);
  await expect(boardElement(board).locator("square.selected")).toHaveCount(1);
}

/**
 * The squares chessground has classed with `className`, read back as keys.
 *
 * Chessground stores each square's key on the node as a `cgKey` property rather than an attribute
 * (`render.ts`), so this reads the board's own idea of where a highlight is instead of inverting
 * the CSS transform it was positioned with.
 */
const squaresClassed = (board: Locator, className: string): Promise<string[]> =>
  boardElement(board).evaluate(
    (node: Element, selector: string) =>
      [...node.querySelectorAll(selector)].map(
        (square) => (square as { cgKey?: string }).cgKey ?? "",
      ),
    `square.${className}`,
  );

/** The legal destinations chessground is currently showing for the selected piece. */
export const destinationSquares = (board: Locator): Promise<string[]> =>
  squaresClassed(board, "move-dest");

/** The squares chessground is offering as premove destinations — a drill board must offer none. */
export const premoveSquares = (board: Locator): Promise<string[]> =>
  squaresClassed(board, "premove-dest");

/** The piece on `key` as chessground's own `"<colour> <role>"` class, or `null` when empty. */
export const pieceAt = (board: Locator, key: Square): Promise<string | null> =>
  boardElement(board).evaluate(
    (node: Element, square: string) =>
      [...node.querySelectorAll("piece")]
        .filter((piece) => (piece as { cgKey?: string }).cgKey === square)
        .map((piece) => piece.className.replace(/\s+/gu, " ").trim())[0] ?? null,
    key,
  );
