import { identifyDeepest } from "@chess-mcp/chess-tools";
import type { BrowserCommandHandler } from "./types";

export const documentCommands = {
  identify_opening: async (args, context) =>
    identifyDeepest(await context.openings(), (args.pgn as string | undefined) || context.currentPgn()) ?? { opening: null },
  get_selected_subtree: (args, context) => {
    const tree = context.currentTree();
    const selected = context.currentPath();
    const max = (args.max_plies as number | undefined) ?? 80;
    const lines: string[][] = [];
    const walk = (path: number[], tail: string[]) => {
      if (lines.length >= 20) return;
      const node = tree.nodeAt(path);
      if (!node.children.length) { lines.push(tail.slice(0, max)); return; }
      node.children.forEach((child, index) => walk([...path, index], [...tail, child.data.san]));
    };
    walk(selected, []);
    return { selected_path: tree.sanPathAt(selected), lines, truncated: lines.length === 20 };
  },
  get_document_pgn: (_args, context) => ({ revision: context.currentRevision(), pgn: context.currentPgn() }),
  propose_line: (args, context) => context.proposeLine((args.moves as string[]) ?? [], args.comment as string | undefined),
} satisfies Record<string, BrowserCommandHandler>;
