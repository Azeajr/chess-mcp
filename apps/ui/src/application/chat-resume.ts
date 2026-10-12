import { createEffect, createRoot } from "solid-js";
import { busy, continueAfterWait, pendingResume, type PendingResume } from "../store/chat";
import { currentTree, fileName } from "../store/game";
import { strategicFitLifecycle } from "../store/strategic-fit";
import { strategicFitProfile } from "../store/strategic-fit-profile";
import { strategicFitSetupRequired } from "./ui-adapters/strategic-fit";

// A user who comes back much later has moved on; their old request is not continued unprompted.
const RESUME_WINDOW_MS = 30 * 60 * 1000;

/**
 * The note that continues a paused request once the user has done what it waited for, or null
 * while they have not. It says what the user did, so the model can carry on without asking.
 */
export function resumeNote(pending: PendingResume, now = Date.now()): string | null {
  if (now - pending.at > RESUME_WINDOW_MS) return null;
  const request = `Continue their request: "${pending.request}"`;
  if (pending.wait === "strategic-fit-setup") {
    if (strategicFitSetupRequired() || strategicFitLifecycle().status === "running") return null;
    return `[App] The user finished Strategic Fit setup in the app (profile: ${strategicFitProfile().mode}). ${request}`;
  }
  if (currentTree().stats().nodes <= 1) return null;
  return `[App] The user opened ${fileName() ?? "a document"}. ${request}`;
}

let observing = false;

/** Continues a paused chat request, once, when the user completes the step it waited for. */
export function observeChatResume() {
  if (observing) return;
  observing = true;
  createRoot(() => {
    createEffect(() => {
      const pending = pendingResume();
      if (!pending || busy()) return;
      const note = resumeNote(pending);
      if (note !== null) void continueAfterWait(note);
    });
  });
}
