/** Pending promotion: a pawn move awaiting the user's piece choice (modal). */
import { createSignal } from "solid-js";
import type { Color } from "./game";

export interface PendingPromo {
  orig: string;
  dest: string;
  color: Color;
}

export const [pendingPromo, setPendingPromo] = createSignal<PendingPromo | null>(null);
