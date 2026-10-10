import { For, Show, createMemo } from "solid-js";
import { selectReviewedMove } from "../application/review-selection";
import { selectedReview } from "../store/guided-ui";
import { centipawnDelta, numbered } from "../content/format";

export default function ReviewFindings(props: {
  resultId: string;
  result: Record<string, unknown>;
}) {
  const moves = createMemo(() =>
    Array.isArray(props.result.moves)
      ? [...(props.result.moves as Record<string, unknown>[])].sort(
          (a, b) => Number(b.cp_loss ?? 0) - Number(a.cp_loss ?? 0),
        )
      : [],
  );
  const flagged = () =>
    moves().filter(
      (move) => typeof move.classification === "string" && move.classification !== "good",
    );
  return (
    <div class="result-card">
      <div class="result-title">
        Move findings ·{" "}
        {typeof props.result.total_moves === "number" ? props.result.total_moves : moves().length}{" "}
        analysed
      </div>
      <div class="result-summary">
        {flagged().length} flagged moves. Select a move to see the position before it.
      </div>
      <Show when={moves().length} fallback={<p>No move findings were returned.</p>}>
        <For each={flagged().length ? flagged() : moves()}>
          {(move) => (
            <button
              class="result-nav"
              aria-pressed={
                selectedReview()?.resultId === props.resultId && selectedReview()?.ply === move.ply
              }
              onClick={() => selectReviewedMove(props.resultId, Number(move.ply))}
            >
              <span>{typeof move.classification === "string" ? move.classification : "Move"}</span>
              <b>
                {numbered([typeof move.san === "string" ? move.san : ""], Number(move.ply) - 1)}
                {typeof move.cp_loss === "number" ? centipawnDelta(move.cp_loss) : ""}
              </b>
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}
