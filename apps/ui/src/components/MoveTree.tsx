/**
 * Move list: mainline in sequence, variations indented (Lichess-style), recursive. Each
 * move navigates to its node; the current node is highlighted. Reads the store's tree +
 * path signals so it re-renders on play/navigate.
 */
import { createMemo, Show, type JSX } from "solid-js";
import type { Node, ChildNode, PgnNodeData } from "chessops/pgn";
import { currentTree, currentPath, actions } from "../store/game";
import { previewedKeys } from "../store/suggestions";
import { focusLine } from "../store/chat";
import type { Path } from "@chess-mcp/chess-tools";

const pathEq = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i]);

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
  const render = createMemo(() => {
    const tree = currentTree();
    const cur = currentPath();
    const previewed = previewedKeys();

    const onMoveClick = (path: Path) => {
      actions.goto(path);
      focusLine(path); // Feature 2: drop a context marker into chat
    };

    const moveSpan = (node: ChildNode<PgnNodeData>, path: Path, blackDots: boolean): JSX.Element => (
      <>
        <span
          class={`move${pathEq(path, cur) ? " current" : ""}${previewed.has(path.join(",")) ? " move-preview" : ""}`}
          onClick={() => onMoveClick(path)}
        >
          {moveLabel(node.data.san, path.length, blackDots)}
        </span>{" "}
      </>
    );

    // Render one line (a node's descendants): mainline inline, each sibling variation as an
    // indented block. `blackDots` forces "N..." when a line starts on Black's move.
    const renderLine = (node: Node<PgnNodeData>, basePath: Path, blackDots: boolean): JSX.Element[] => {
      const parts: JSX.Element[] = [];
      let cursor: Node<PgnNodeData> = node;
      let path = basePath;
      let dots = blackDots;
      while (cursor.children.length) {
        const main = cursor.children[0] as ChildNode<PgnNodeData>;
        const mainPath = [...path, 0];
        parts.push(moveSpan(main, mainPath, dots));

        for (let i = 1; i < cursor.children.length; i++) {
          const v = cursor.children[i] as ChildNode<PgnNodeData>;
          const vPath = [...path, i];
          parts.push(
            <div class="variation">
              ({moveSpan(v, vPath, true)}
              {renderLine(v, vPath, false)})
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
      <Show
        when={render().length}
        fallback={<div class="empty">No moves yet — play on the board.</div>}
      >
        {render()}
      </Show>
    </div>
  );
}
