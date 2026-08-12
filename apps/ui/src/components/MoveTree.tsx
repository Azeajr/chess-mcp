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

  const isActive = (path: Path) => pathEq(path, activePath() ?? currentPath());
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

  const activateMove = (path: Path) => {
    actions.goto(path);
    focusLine(path); // Feature 2: drop a context marker into chat
    setActivePath([...path]);
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
    const active = activePath() ?? currentPath();
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      activateMove(active);
      return;
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

    const moveButton = (
      node: ChildNode<PgnNodeData>,
      path: Path,
      blackDots: boolean,
      siblingCount: number,
    ): JSX.Element => (
      <MoveButton
        id={itemId(path)}
        role="treeitem"
        data-move-path={path.join(",")}
        aria-current={pathEq(path, current) ? "true" : undefined}
        aria-level={path.length}
        aria-posinset={(path.at(-1) ?? 0) + 1}
        aria-setsize={siblingCount}
        tabIndex={isActive(path) ? 0 : -1}
        current={pathEq(path, current)}
        previewed={previewed.has(path.join(","))}
        onFocus={() => setActivePath([...path])}
        onClick={() => {
          activateMove(path);
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
        parts.push(moveButton(main, mainPath, dots, cursor.children.length), " ");

        // A branch point: ≥2 children. The separate control avoids a nested button and is not a
        // page-level tab stop; ArrowRight gives keyboard users the agreed variation entry path.
        const branch = cursor.children.length > 1;
        if (branch) {
          const branchPath = [...path];
          const isCollapsed =
            collapsedSet.has(pathKey(branchPath)) && !currentInsideVariation(branchPath);
          const hidden = cursor.children.length - 1;
          const variations: JSX.Element[] = [];
          for (let index = 1; index < cursor.children.length; index += 1) {
            const variation = cursor.children[index];
            if (variation === undefined) continue;
            const variationPath = [...branchPath, index];
            variations.push(
              <div class="variation">
                ({moveButton(variation, variationPath, true, cursor.children.length)}{" "}
                {renderLine(variation, variationPath, false)})
              </div>,
            );
          }
          parts.push(
            <div class="variation-group">
              <button
                class="collapse-toggle"
                type="button"
                tabIndex={-1}
                aria-label={isCollapsed ? `Show ${hidden} variation(s)` : "Hide variations"}
                aria-expanded={!isCollapsed}
                aria-controls={groupId(branchPath)}
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
