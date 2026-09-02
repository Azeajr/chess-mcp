import {
  buildRepertoireGraph,
  suggestStrategicFitIntentFromComments,
  type Color,
  type GameTree,
  type StrategicFitCommentIntentDecision,
  type StrategicFitCommentIntentDisposition,
  type StrategicFitCommentIntentSuggestion,
  type StrategicFitDocumentMetadata,
  type StrategicFitMetadataNormalizationResult,
} from "@chess-mcp/chess-tools";
import { color, currentTree } from "./game";
import { replaceStrategicFitMetadata, strategicFitMetadata } from "./strategic-fit-metadata";

export interface StrategicFitDisplayedIntentSuggestion extends StrategicFitCommentIntentSuggestion {
  readonly disposition: StrategicFitCommentIntentDisposition | null;
  readonly decision: StrategicFitCommentIntentDecision | null;
}

export interface StrategicFitIntentCommentBoundary {
  currentTree(): GameTree;
  repertoireColor(): Color;
  currentMetadata(): StrategicFitDocumentMetadata;
  replaceMetadata(input: StrategicFitDocumentMetadata): StrategicFitMetadataNormalizationResult;
  now(): string;
}

export interface StrategicFitIntentCommentState {
  suggestions(): readonly StrategicFitDisplayedIntentSuggestion[];
  decide(
    suggestionId: string,
    disposition: StrategicFitCommentIntentDisposition,
  ): StrategicFitCommentIntentDecision;
}

function currentSuggestions(boundary: StrategicFitIntentCommentBoundary) {
  const tree = boundary.currentTree();
  return suggestStrategicFitIntentFromComments(
    tree,
    buildRepertoireGraph(tree, boundary.repertoireColor()),
  );
}

export function createStrategicFitIntentCommentState(
  boundary: StrategicFitIntentCommentBoundary,
): StrategicFitIntentCommentState {
  return {
    suggestions() {
      const decisions = new Map(
        boundary.currentMetadata().comment_intents.map((entry) => [entry.suggestion_id, entry]),
      );
      return currentSuggestions(boundary).map((suggestion) => {
        const decision = decisions.get(suggestion.suggestion_id) ?? null;
        return {
          ...suggestion,
          disposition: decision?.disposition ?? null,
          decision,
        };
      });
    },

    decide(suggestionId, disposition) {
      const suggestion = currentSuggestions(boundary).find(
        (entry) => entry.suggestion_id === suggestionId,
      );
      if (!suggestion) throw new Error("strategic_fit_intent_suggestion_stale");
      const metadata = boundary.currentMetadata();
      const existing = metadata.comment_intents.find(
        (entry) => entry.suggestion_id === suggestionId,
      );
      const timestamp = boundary.now();
      const decision: StrategicFitCommentIntentDecision = {
        decision_id:
          existing?.decision_id ??
          `comment-intent-decision:${suggestionId.slice("comment-intent:".length)}`,
        suggestion_id: suggestion.suggestion_id,
        disposition,
        kind: suggestion.kind,
        intent_value: suggestion.intent_value,
        detection: suggestion.detection,
        source_comment: suggestion.source_comment,
        source_match: suggestion.source_match,
        source_comment_index: suggestion.source_comment_index,
        source_match_index: suggestion.source_match_index,
        source_san_path: [...suggestion.source_san_path],
        references: {
          position_ids: [...suggestion.references.position_ids],
          decision_ids: [...suggestion.references.decision_ids],
          route_ids: [...suggestion.references.route_ids],
          source_san_paths: suggestion.references.source_san_paths.map((path) => [...path]),
        },
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
        provenance: [
          {
            source_id: `strategic-fit:pgn-comment:${suggestion.suggestion_id}`,
            kind: "user-profile",
            state: "available",
            version: "1",
            snapshot: suggestion.suggestion_id,
            reason:
              disposition === "confirmed"
                ? "The user confirmed this exact PGN comment suggestion."
                : "The user rejected this exact PGN comment suggestion.",
          },
        ],
      };
      const result = boundary.replaceMetadata({
        ...metadata,
        comment_intents: [
          ...metadata.comment_intents.filter((entry) => entry.suggestion_id !== suggestionId),
          decision,
        ],
      });
      const saved = result.metadata.comment_intents.find(
        (entry) => entry.suggestion_id === suggestionId,
      );
      if (!saved) throw new Error("strategic_fit_intent_decision_not_persisted");
      return saved;
    },
  };
}

const strategicFitIntentComments = createStrategicFitIntentCommentState({
  currentTree,
  repertoireColor: color,
  currentMetadata: strategicFitMetadata,
  replaceMetadata: (input) => replaceStrategicFitMetadata(input),
  now: () => new Date().toISOString(),
});

export function strategicFitIntentCommentSuggestions(): readonly StrategicFitDisplayedIntentSuggestion[] {
  return strategicFitIntentComments.suggestions();
}

export function decideStrategicFitIntentComment(
  suggestionId: string,
  disposition: StrategicFitCommentIntentDisposition,
): StrategicFitCommentIntentDecision {
  return strategicFitIntentComments.decide(suggestionId, disposition);
}
