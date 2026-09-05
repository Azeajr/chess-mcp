import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { Node as PgnNode, ChildNode, PgnNodeData } from "chessops/pgn";
import { currentTree, currentPath, actions } from "../store/game";
import { previewedKeys } from "../store/suggestions";
import { focusLine } from "../store/chat";
import { openFile } from "../store/files";
import MoveButton, { MoveTreeItem } from "./primitives/MoveButton";
import type { Path } from "@chess-mcp/chess-tools";

const pathEq = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i]);
const isPrefix = (prefix: Path, of: Path) =>
  prefix.length <= of.length && prefix.every((v, i) => of[i] === v);
const pathKey = (path: Path) => (path.length ? path.join(",") : "root");
const itemId = (path: Path) => `move-tree-item-${path.length ? path.join("-") : "root"}`;
const groupId = (path: Path) => `move-tree-group-${path.length ? path.join("-") : "root"}`;

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

function moveAccessibleLabel(
  san: string,
  ply: number,
  forceBlackDots: boolean,
  level: number,
  branch?: { expanded: boolean },
): string {
  const moveNo = Math.floor((ply - 1) / 2) + 1;
  const isWhite = ply % 2 === 1;
  const prefix = isWhite ? `${moveNo}. ` : forceBlackDots ? `${moveNo}... ` : "";
  const state = branch ? `, ${branch.expanded ? "expanded" : "collapsed"}` : "";
  return `${prefix}${san}, repertoire tree item, level ${level}${state}`;
}

export default function MoveTree() {
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
  const [activePath, setActivePath] = createSignal<Path | null>(null);
  let treeElement: HTMLDivElement | undefined;

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
    focusLine(path);
    if (keepFocus) focusItem(path);
    else setActivePath([...path]);
  };

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
    if (event.key === " ") {
      const branchPath = active.slice(0, -1);
      if (currentTree().nodeAt(branchPath).children.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        toggleGroup(branchPath);
        focusItem(active);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activateMove(active, true);
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
      position?: { posinset: number; setsize: number },
      branch?: { expanded: boolean; group: string },
    ): JSX.Element => (
      <MoveTreeItem
        id={itemId(path)}
        role="treeitem"
        data-move-path={path.join(",")}
        aria-label={moveAccessibleLabel(
          node.data.san,
          path.length,
          blackDots,
          variationLevel(path),
          branch,
        )}
        aria-current={pathEq(path, current) ? "true" : undefined}
        aria-level={variationLevel(path)}
        aria-posinset={position?.posinset}
        aria-setsize={position?.setsize}
        aria-expanded={branch ? branch.expanded : undefined}
        aria-controls={branch?.group}
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
      </MoveTreeItem>
    );

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
                {moveButton(variation, variationPath, true, {
                  posinset: index,
                  setsize: cursor.children.length - 1,
                })}{" "}
                {renderLine(variation, variationPath, false)}
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
                class={`collapse-toggle${isCollapsed ? " is-collapsed" : ""}`}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                data-branch-path={branchPath.join(",")}
                title={isCollapsed ? `Show ${hidden} variation(s)` : "Hide variations"}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleGroup(branchPath);
                }}
              >
                {/* Collapsed states the size of what is hidden; expanded draws a chevron in CSS,
                    so the control never reads as a "remove" minus sign. */}
                {isCollapsed ? hidden : ""}
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
          fallback={
            <div class="move-tree-empty">
              <p class="move-tree-empty-title">No moves yet</p>
              <p class="move-tree-empty-body">
                Play a move on the board to start a line, or open an existing PGN.
              </p>
              <button type="button" class="ui-button" onClick={openFile}>
                Open PGN
              </button>
            </div>
          }
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
