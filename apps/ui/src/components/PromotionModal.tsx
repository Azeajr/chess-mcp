import { For, Show } from "solid-js";
import { pendingPromo, setPendingPromo } from "../store/promotion";
import { actions } from "../store/game";
import Dialog from "./primitives/Dialog";

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
        <Dialog
          title="Promote pawn — dismiss to cancel the move"
          class="promo"
          dismissOnBackdrop
          onClose={() => setPendingPromo(null)}
        >
          <For each={ROLES}>
            {(role) => (
              <button
                class="promo-piece"
                type="button"
                aria-label={`Promote to ${role}`}
                onClick={() => {
                  actions.play(p().orig, p().dest, role);
                  setPendingPromo(null);
                }}
              >
                {GLYPH[role][p().color]}
              </button>
            )}
          </For>
        </Dialog>
      )}
    </Show>
  );
}
