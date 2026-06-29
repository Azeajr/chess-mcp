/**
 * Promotion picker: shown when a pawn reaches the last rank. Picking a piece plays the move
 * with that promotion; dismissing cancels the move (the board reverts via the Board sync effect,
 * which also depends on the pending-promotion signal).
 */
import { For, Show } from "solid-js";
import { pendingPromo, setPendingPromo } from "../store/promotion";
import { actions } from "../store/game";

const ROLES = ["queen", "rook", "bishop", "knight"] as const;
const GLYPH: Record<(typeof ROLES)[number], { white: string; black: string }> = {
  queen: { white: "♕", black: "♛" },
  rook: { white: "♖", black: "♜" },
  bishop: { white: "♗", black: "♝" },
  knight: { white: "♘", black: "♞" },
};

export default function PromotionModal() {
  return (
    <Show when={pendingPromo()}>
      {(p) => (
        <div class="promo-backdrop" onClick={() => setPendingPromo(null)}>
          <div class="promo" onClick={(e) => e.stopPropagation()}>
            <For each={ROLES}>
              {(role) => (
                <button
                  class="promo-piece"
                  onClick={() => {
                    actions.play(p().orig, p().dest, role);
                    setPendingPromo(null);
                  }}
                >
                  {GLYPH[role][p().color]}
                </button>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}
