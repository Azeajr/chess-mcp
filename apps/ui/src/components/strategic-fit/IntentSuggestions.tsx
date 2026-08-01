import { For, Show, createMemo } from "solid-js";
import {
  decideStrategicFitIntentComment,
  strategicFitIntentCommentSuggestions,
} from "../../store/strategic-fit-intent-comments";

const KIND_LABELS = {
  "retain-line": "Retain this line intentionally",
  "tournament-weapon": "Tournament-specific weapon",
  "avoid-concept": "Avoid this strategic concept",
} as const;

const pathLabel = (path: readonly string[]) =>
  path.length === 0 ? "Starting position" : path.join(" ");

export default function IntentSuggestions() {
  const suggestions = createMemo(() => strategicFitIntentCommentSuggestions());
  const pendingCount = () => suggestions().filter((entry) => entry.disposition === null).length;
  return (
    <Show when={suggestions().length > 0}>
      <details class="strategic-fit-intent-suggestions" open={pendingCount() > 0}>
        <summary>
          PGN intent suggestions
          <span>{pendingCount() > 0 ? `${pendingCount()} to review` : "reviewed"}</span>
        </summary>
        <p>
          These comments remain ordinary PGN text unless you confirm them. Dismissing an exact
          comment is remembered until that comment or its path changes.
        </p>
        <div class="strategic-fit-intent-list">
          <For each={suggestions()}>
            {(suggestion) => (
              <article data-intent-disposition={suggestion.disposition ?? "pending"}>
                <header>
                  <strong>{KIND_LABELS[suggestion.kind]}</strong>
                  <span>{suggestion.detection === "tag" ? "Tagged" : "Phrase"}</span>
                </header>
                <div class="strategic-fit-intent-path">
                  <span>Path</span> {pathLabel(suggestion.source_san_path)}
                </div>
                <blockquote>“{suggestion.source_comment}”</blockquote>
                <div class="strategic-fit-intent-match">Matched “{suggestion.source_match}”</div>
                <Show
                  when={suggestion.disposition === null}
                  fallback={
                    <div class="strategic-fit-intent-status" role="status">
                      {suggestion.disposition === "confirmed"
                        ? "Confirmed as structured intent"
                        : "Dismissed for this unchanged comment"}
                    </div>
                  }
                >
                  <div class="strategic-fit-intent-actions">
                    <button
                      type="button"
                      onClick={() =>
                        decideStrategicFitIntentComment(suggestion.suggestion_id, "confirmed")
                      }
                    >
                      Confirm intent
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        decideStrategicFitIntentComment(suggestion.suggestion_id, "rejected")
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </Show>
              </article>
            )}
          </For>
        </div>
      </details>
    </Show>
  );
}
