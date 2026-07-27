/**
 * Deterministic, read-only intent suggestions from ordinary PGN comments.
 *
 * Detection never changes the tree or profile. A host must present a suggestion and record an
 * explicit user decision before any text becomes structured Strategic Fit metadata.
 */
import type { ChildNode, PgnNodeData } from "chessops/pgn";
import type { GameTree } from "../pgn.js";
import type { RepertoireGraph } from "./graph.js";
import type { SemanticReferences } from "./types.js";

export const STRATEGIC_FIT_COMMENT_INTENT_KINDS = [
  "retain-line",
  "tournament-weapon",
  "avoid-concept",
] as const;
export type StrategicFitCommentIntentKind =
  (typeof STRATEGIC_FIT_COMMENT_INTENT_KINDS)[number];

export const STRATEGIC_FIT_COMMENT_INTENT_DETECTIONS = ["tag", "phrase"] as const;
export type StrategicFitCommentIntentDetection =
  (typeof STRATEGIC_FIT_COMMENT_INTENT_DETECTIONS)[number];

export interface StrategicFitCommentIntentSuggestion {
  readonly suggestion_id: string;
  readonly kind: StrategicFitCommentIntentKind;
  /** Canonical machine value; display copy always retains and quotes the original text separately. */
  readonly intent_value: string;
  readonly detection: StrategicFitCommentIntentDetection;
  readonly source_comment: string;
  readonly source_match: string;
  readonly source_comment_index: number;
  readonly source_match_index: number;
  readonly source_san_path: readonly string[];
  readonly references: SemanticReferences;
}

interface CandidateMatch {
  readonly kind: StrategicFitCommentIntentKind;
  readonly value: string;
  readonly detection: StrategicFitCommentIntentDetection;
  readonly start: number;
  readonly text: string;
}

const TAG_PATTERN = /\[%strategic-fit\s+(?:intent\s*=\s*)?(keep|must-keep|tournament-weapon|avoid-queenless-(?:middlegame|endgame))\s*\]/giu;
const PHRASE_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly kind: StrategicFitCommentIntentKind;
  readonly value: string;
}[] = [
  { pattern: /\bmust\s+keep\b/giu, kind: "retain-line", value: "keep-intentionally" },
  { pattern: /\btournament\s+weapon\b/giu, kind: "tournament-weapon", value: "tournament-specific" },
  {
    pattern: /\bavoid\s+(?:the\s+)?queenless\s+(?:middle\s*game|endgame)\b/giu,
    kind: "avoid-concept",
    value: "endgame-tendency.queenless",
  },
];

const ID_SEPARATOR = "\u001f";

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return path.length >= prefix.length && prefix.every((entry, index) => entry === path[index]);
}

function referencesForPath(graph: RepertoireGraph, path: readonly string[]): SemanticReferences {
  const positionIds = path.length === 0
    ? [graph.root_position_id]
    : graph.positions
      .filter((position) => position.source_san_paths.some((candidate) => samePath(candidate, path)))
      .map((position) => position.position_id);
  const decisionIds = graph.decisions
    .filter((decision) => decision.source_san_paths.some((candidate) => samePath(candidate, path)))
    .map((decision) => decision.decision_id);
  const routeIds = graph.routes
    .filter((route) => route.source_san_paths.some((candidate) => pathStartsWith(candidate, path)))
    .map((route) => route.route_id);
  return {
    position_ids: [...new Set(positionIds)].sort(compareStrings),
    decision_ids: [...new Set(decisionIds)].sort(compareStrings),
    route_ids: [...new Set(routeIds)].sort(compareStrings),
    source_san_paths: [[...path]],
  };
}

function tagMeaning(value: string): Pick<CandidateMatch, "kind" | "value"> {
  if (value === "tournament-weapon") {
    return { kind: "tournament-weapon", value: "tournament-specific" };
  }
  if (value.startsWith("avoid-queenless-")) {
    return { kind: "avoid-concept", value: "endgame-tendency.queenless" };
  }
  return { kind: "retain-line", value: "keep-intentionally" };
}

function matchesInComment(comment: string): CandidateMatch[] {
  const matches: CandidateMatch[] = [];
  const taggedRanges: { start: number; end: number }[] = [];
  for (const match of comment.matchAll(TAG_PATTERN)) {
    const text = match[0];
    const rawValue = match[1];
    if (text === undefined || rawValue === undefined || match.index === undefined) continue;
    const meaning = tagMeaning(rawValue.toLocaleLowerCase("en-US"));
    taggedRanges.push({ start: match.index, end: match.index + text.length });
    matches.push({ ...meaning, detection: "tag", start: match.index, text });
  }
  for (const definition of PHRASE_PATTERNS) {
    for (const match of comment.matchAll(definition.pattern)) {
      const text = match[0];
      if (text === undefined || match.index === undefined) continue;
      const end = match.index + text.length;
      if (taggedRanges.some((range) => match.index! < range.end && end > range.start)) continue;
      matches.push({
        kind: definition.kind,
        value: definition.value,
        detection: "phrase",
        start: match.index,
        text,
      });
    }
  }
  return matches.sort((left, right) =>
    left.start - right.start || compareStrings(left.kind, right.kind) || compareStrings(left.text, right.text)
  );
}

/** Find supported tags/phrases without changing comments, nodes, headers, or variation ordering. */
export function suggestStrategicFitIntentFromComments(
  tree: GameTree,
  graph: RepertoireGraph,
): StrategicFitCommentIntentSuggestion[] {
  const suggestions: StrategicFitCommentIntentSuggestion[] = [];
  const visitComments = (comments: readonly string[] | undefined, path: readonly string[]) => {
    for (const [commentIndex, comment] of (comments ?? []).entries()) {
      if (typeof comment !== "string") continue;
      for (const [matchIndex, match] of matchesInComment(comment).entries()) {
        const identity = [
          path.join(ID_SEPARATOR),
          comment,
          matchIndex,
          match.start,
          match.kind,
          match.value,
          match.detection,
        ].join(ID_SEPARATOR);
        const suggestion = {
          suggestion_id: `comment-intent:${stableHash(identity)}`,
          kind: match.kind,
          intent_value: match.value,
          detection: match.detection,
          source_comment: comment,
          source_match: match.text,
          source_comment_index: commentIndex,
          source_match_index: matchIndex,
          source_san_path: [...path],
          references: referencesForPath(graph, path),
        } satisfies StrategicFitCommentIntentSuggestion;
        if (!suggestions.some((entry) => entry.suggestion_id === suggestion.suggestion_id)) {
          suggestions.push(suggestion);
        }
      }
    }
  };

  visitComments(tree.game.comments, []);
  const visitNode = (node: ChildNode<PgnNodeData>, path: readonly string[]) => {
    const nextPath = [...path, node.data.san];
    visitComments(node.data.comments, nextPath);
    for (const child of node.children) visitNode(child, nextPath);
  };
  for (const child of tree.game.moves.children) visitNode(child, []);

  return suggestions.sort((left, right) =>
    compareStrings(left.source_san_path.join(ID_SEPARATOR), right.source_san_path.join(ID_SEPARATOR)) ||
    left.source_comment_index - right.source_comment_index ||
    left.source_match_index - right.source_match_index ||
    compareStrings(left.suggestion_id, right.suggestion_id)
  );
}
