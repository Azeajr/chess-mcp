/**
 * Move list: mainline in sequence, variations indented (Lichess-style), recursive. The tree is
 * one page-level Tab stop; arrows move its roving active item without changing the board.
 */
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { Node as PgnNode, ChildNode, PgnNodeData } from "chessops/pgn";
import { currentTree, currentPath, actions } from "../store/game";
import { previewedKeys } from "../store/suggestions";
import { focusLine } from "../store/chat";
import MoveButton from "./primitives/MoveButton";
import type { Path } from "@chess-mcp/chess-tools";

const pathEq = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i]);
const isPrefix = (prefix: Path, of: Path) =>
  prefix.length <= of.length && prefix.every((v, i) => of[i] === v);
const pathKey = (path: Path) => (path.length ? path.join(",") : "root");
const itemId = (path: Path) => `move-tree-item-${path.length ? path.join("-") : "root"}`;
const groupId = (path: Path) => `move-tree-group-${path.length ? path.join("-") : "root"}`;

/**
 * How deep into variations a move sits, which is what `aria-level` reports. Deliberately not the
 * path length: a PGN path grows one index per ply, so ply depth would make every mainline move its
 * own level and screen readers announce a level on every change — an announcement per arrow press
 * along the mainline, which is AG-3's "traversal produces speech floods" failure condition. Only a
 * non-zero index means a variation was entered, so counting those gives the mainline a single flat
 * level and matches what a repertoire user means by depth.
 */
const variationLevel = (path: Path) => 1 + path.filter((index) => index >= 1).length;

function moveLabel(san: string, ply: number, forceBlackDots: boolean): JSX.Element {
  const moveNo = Math.floor((ply - 1) / 2) + 1;
  const isWhite = ply % 2 === 1;
  const prefix = isWhite ? `${moveNo}.` : forceBlackDots ? `${moveNo}...` : "";
  return (
    <>
      <Show when={prefix}>
        <span class="moveno">{prefix} </span>
      </Show>
      {san}
    </>
  );
}

export default function MoveTree() {
  // Feature 3: per-branch collapse state, session-only (keyed by the parent's index path).
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
  // Null means that the next Tab entry follows the board's current move.
  const [activePath, setActivePath] = createSignal<Path | null>(null);
  let treeElement: HTMLDivElement | undefined;

  /**
   * Where Tab enters the tree. The board's current move owns that slot, but the root has no
   * rendered item: at the start position `currentPath()` is `[]`, which matches nothing, and the
   * tree would have no tab stop at all. Fall back to the first move.
   */
  const entryPath = (): Path => {
    const active = activePath();
    if (active !== null) return active;
    const current = currentPath();
    if (current.length) return current;
    return currentTree().game.moves.children.length ? [0] : [];
  };
  const isActive = (path: Path) => pathEq(path, entryPath());
  const focusItem = (path: Path) => {
    setActivePath([...path]);
    queueMicrotask(() => treeElement?.querySelector<HTMLElement>(`#${itemId(path)}`)?.focus());
  };
  const revealPath = (path: Path) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (let depth = 0; depth < path.length; depth += 1) {
        if ((path[depth] ?? 0) >= 1) next.delete(pathKey(path.slice(0, depth)));
      }
      return next;
    });
  const focusPath = (path: Path) => {
    revealPath(path);
    focusItem(path);
  };

  const activeInsideVariation = (parentPath: Path) => {
    const active = activePath();
    return (
      active !== null &&
      active.length > parentPath.length &&
      isPrefix(parentPath, active) &&
      (active[parentPath.length] ?? 0) >= 1
    );
  };
  const currentInsideVariation = (parentPath: Path) => {
    const current = currentPath();
    return (
      current.length > parentPath.length &&
      isPrefix(parentPath, current) &&
      (current[parentPath.length] ?? 0) >= 1
    );
  };
  const toggleGroup = (path: Path) => {
    // Never hide either the board's current node or the roving focus target.
    if (currentInsideVariation(path) || activeInsideVariation(path)) return;
    const key = pathKey(path);
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activateMove = (path: Path, keepFocus = false) => {
    actions.goto(path);
    focusLine(path); // Feature 2: drop a context marker into chat
    // Navigating rebuilds every item, so the button that handled the activation is gone by the
    // time the store settles. Without re-focusing, Enter drops focus to the body.
    if (keepFocus) focusItem(path);
    else setActivePath([...path]);
  };

  // The line from the root to the current node, in plain sequence — the header strip so the user
  // can read which moves got them here without tracing the tree. It stays pointer-accessible but
  // has no independent page-level tab stop; the tree owns keyboard move navigation.
  const currentLine = createMemo(() => {
    const tree = currentTree();
    const current = currentPath();
    const out: { san: string; ply: number; path: Path }[] = [];
    let node: PgnNode<PgnNodeData> = tree.game.moves;
    for (let index = 0; index < current.length; index += 1) {
      const childIndex = current[index];
      if (childIndex === undefined) break;
      const child = node.children[childIndex];
      if (!child) break;
      out.push({ san: child.data.san, ply: index + 1, path: current.slice(0, index + 1) });
      node = child;
    }
    return out;
  });

  const lastPath = (node: PgnNode<PgnNodeData>, basePath: Path): Path => {
    if (!node.children.length) return basePath;
    const index = node.children.length - 1;
    const nextPath = [...basePath, index];
    const child = node.children[index];
    return child ? lastPath(child, nextPath) : basePath;
  };

  const keyTarget = (path: Path, key: string): Path => {
    const tree = currentTree();
    const node = tree.nodeAt(path);
    const parentPath = path.slice(0, -1);
    const parent = tree.nodeAt(parentPath);
    const siblingIndex = path.at(-1) ?? 0;
    switch (key) {
      case "ArrowDown":
        return parent.children[siblingIndex + 1] ? [...parentPath, siblingIndex + 1] : path;
      case "ArrowUp":
        return siblingIndex > 0 && parent.children[siblingIndex - 1]
          ? [...parentPath, siblingIndex - 1]
          : path;
      case "ArrowRight":
        // DV-2: prefer the first non-mainline reply; otherwise continue the mainline.
        if (node.children.length > 1) return [...path, 1];
        return node.children[0] ? [...path, 0] : path;
      case "ArrowLeft":
        return parentPath.length ? parentPath : path;
      case "Home":
        return tree.game.moves.children[0] ? [0] : path;
      case "End":
        return lastPath(tree.game.moves, []);
      default:
        return path;
    }
  };

  const onTreeKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "treeitem") return;
    const active = entryPath();
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      activateMove(active, true);
      return;
    }
    // The collapse toggle is not a page-level Tab stop — a tree with one tab stop cannot also hand
    // out one per branch — so the branch it controls needs a key inside the tree, or collapsing
    // becomes pointer-only. Space, which no DV-2 arrow semantics claim; on a move with no
    // variations it falls through to the button's native activation, matching the rows.
    if (event.key === " ") {
      const branchPath = active.slice(0, -1);
      if (currentTree().nodeAt(branchPath).children.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        toggleGroup(branchPath);
        // Collapsing rebuilds the tree, so the focused item has to be re-established here too.
        focusItem(active);
        return;
      }
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    event.stopPropagation();
    focusPath(keyTarget(active, event.key));
  };

  const render = createMemo(() => {
    const tree = currentTree();
    const current = currentPath();
    const previewed = previewedKeys();
    const collapsedSet = collapsed();

    /**
     * `position` is set only on variations, where "2 of 3" says something; a mainline move is not
     * one of a set of alternatives and reporting "1 of 1" on every move is pure verbosity.
     * `branch` is set only on the move that owns a variation group, and carries that group into
     * `aria-expanded`/`aria-controls`/`aria-owns` — see the toggle below for why the state lives
     * here rather than on the toggle itself.
     */
    const moveButton = (
      node: ChildNode<PgnNodeData>,
      path: Path,
      blackDots: boolean,
      position?: { posinset: number; setsize: number },
      branch?: { expanded: boolean; group: string },
    ): JSX.Element => (
      <MoveButton
        id={itemId(path)}
        role="treeitem"
        data-move-path={path.join(",")}
        aria-current={pathEq(path, current) ? "true" : undefined}
        aria-level={variationLevel(path)}
        aria-posinset={position?.posinset}
        aria-setsize={position?.setsize}
        aria-expanded={branch ? branch.expanded : undefined}
        aria-controls={branch?.group}
        // Reparents the variation group under this item in the accessibility tree. The group is a
        // DOM sibling because a tree item here is a <button>, which cannot legally contain one.
        aria-owns={branch?.group}
        tabIndex={isActive(path) ? 0 : -1}
        current={pathEq(path, current)}
        previewed={previewed.has(path.join(","))}
        onFocus={() => setActivePath([...path])}
        onClick={() => {
          activateMove(path, true);
        }}
      >
        {moveLabel(node.data.san, path.length, blackDots)}
      </MoveButton>
    );

    // Render one line (a node's descendants): mainline inline, each sibling variation as an
    // indented block. `blackDots` forces "N..." when a line starts on Black's move.
    const renderLine = (
      node: PgnNode<PgnNodeData>,
      basePath: Path,
      blackDots: boolean,
    ): JSX.Element[] => {
      const parts: JSX.Element[] = [];
      let cursor: PgnNode<PgnNodeData> = node;
      let path = basePath;
      let dots = blackDots;
      while (cursor.children.length) {
        const main = cursor.children.at(0);
        if (main === undefined) break;
        const mainPath = [...path, 0];

        // A branch point: ≥2 children. The separate control avoids a nested button and is not a
        // page-level tab stop; ArrowRight gives keyboard users the agreed variation entry path.
        // Resolved before the mainline move renders, because that move is the one that owns the
        // group and has to carry its expanded state.
        const branch = cursor.children.length > 1;
        const branchPath = [...path];
        const isCollapsed =
          branch && collapsedSet.has(pathKey(branchPath)) && !currentInsideVariation(branchPath);

        parts.push(
          moveButton(
            main,
            mainPath,
            dots,
            undefined,
            branch ? { expanded: !isCollapsed, group: groupId(branchPath) } : undefined,
          ),
          " ",
        );

        if (branch) {
          const hidden = cursor.children.length - 1;
          const variations: JSX.Element[] = [];
          for (let index = 1; index < cursor.children.length; index += 1) {
            const variation = cursor.children[index];
            if (variation === undefined) continue;
            const variationPath = [...branchPath, index];
            variations.push(
              <div class="variation">
                (
                {moveButton(variation, variationPath, true, {
                  posinset: index,
                  setsize: cursor.children.length - 1,
                })}{" "}
                {renderLine(variation, variationPath, false)})
              </div>,
            );
          }
          parts.push(
            <div class="variation-group">
              {/*
                A pointer affordance, not the group's ARIA owner. `aria-expanded` lives on the
                mainline tree item instead: this toggle is tabIndex -1 and role button, so arrow
                traversal never lands on it and a tree item with variations would announce nothing
                about its expanded state. Its own label already states show-versus-hide, so it
                needs no second copy of the state. `data-branch-path` is for test targeting, the
                same split `data-move-path` already makes on the tree items.
              */}
              <button
                class="collapse-toggle"
                type="button"
                tabIndex={-1}
                data-branch-path={branchPath.join(",")}
                aria-label={isCollapsed ? `Show ${hidden} variation(s)` : "Hide variations"}
                title={isCollapsed ? `Show ${hidden} variation(s)` : "Hide variations"}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleGroup(branchPath);
                }}
              >
                {isCollapsed ? `+${hidden}` : "–"}
              </button>
              <div id={groupId(branchPath)} class="variations" role="group" hidden={isCollapsed}>
                {variations}
              </div>
            </div>,
          );
        }

        dots = false;
        cursor = main;
        path = mainPath;
      }
      return parts;
    };

    return renderLine(tree.game.moves, [], false);
  });

  return (
    <div class="move-tree">
      <div class="current-line" title="Current line">
        <Show when={currentLine().length} fallback={<span class="moveno">Start position</span>}>
          <For each={currentLine()}>
            {(move) => (
              <>
                <MoveButton
                  current={pathEq(move.path, currentPath())}
                  tabIndex={-1}
                  onClick={() => {
                    activateMove(move.path);
                  }}
                >
                  {moveLabel(move.san, move.ply, false)}
                </MoveButton>{" "}
              </>
            )}
          </For>
        </Show>
      </div>
      <div class="tree-body">
        <Show
          when={render().length}
          fallback={<div class="empty">No moves yet — play on the board.</div>}
        >
          <div
            ref={treeElement}
            role="tree"
            aria-label="Repertoire moves"
            onKeyDown={onTreeKeyDown}
            onFocusOut={(event) => {
              const next = event.relatedTarget;
              if (!(next instanceof globalThis.Node) || !event.currentTarget.contains(next))
                setActivePath(null);
            }}
          >
            <div role="group" class="tree-root">
              {render()}
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
