import { Show } from "solid-js";
import { changesSinceExport, dirty, fileName } from "../store/game";
import {
  cancelDocumentClose,
  continueDocumentClose,
  documentCloseError,
  pendingDocumentClose,
  saveAndContinueDocumentClose,
  savingDocumentClose,
} from "../store/files";
import Dialog from "./primitives/Dialog";
import { setRecoverDialogOpen } from "../store/persist";

const intentLabel = {
  new: "start a new repertoire",
  open: "open a different PGN",
  reopen: "reopen the saved PGN",
} as const;

const discardLabel = {
  new: "Discard and start new",
  open: "Discard and open PGN",
  reopen: "Discard and reopen",
} as const;

function currentDocumentName() {
  return fileName() ?? "the current repertoire";
}

export default function DocumentCloseDialog() {
  return (
    <Show when={pendingDocumentClose()}>
      {(pending) => {
        const hasUnexportedChanges = () => dirty();
        return (
          <Dialog
            title="Replace current repertoire?"
            description={`Continuing will ${intentLabel[pending().intent]} and replace ${currentDocumentName()}.`}
            class="document-close-dialog"
            initialFocus="[data-document-close-safe]"
            onClose={cancelDocumentClose}
          >
            <Show
              when={hasUnexportedChanges()}
              fallback={<p class="document-close-copy">There are no unexported changes.</p>}
            >
              <p class="document-close-copy">
                {currentDocumentName()} has {changesSinceExport()} unexported{" "}
                {changesSinceExport() === 1 ? "change" : "changes"}.
              </p>
            </Show>
            <Show when={documentCloseError()}>
              {(error) => (
                <p class="document-close-error" role="alert">
                  {error()}
                </p>
              )}
            </Show>
            <div class="document-close-actions">
              <Show
                when={hasUnexportedChanges()}
                fallback={
                  <>
                    <button data-document-close-safe onClick={cancelDocumentClose}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="document-close-recover"
                      onClick={() => {
                        cancelDocumentClose();
                        setRecoverDialogOpen(true);
                      }}
                    >
                      Recover an earlier repertoire
                    </button>
                    <button onClick={continueDocumentClose}>Continue</button>
                  </>
                }
              >
                <button data-document-close-safe onClick={cancelDocumentClose}>
                  Keep working
                </button>
                <button
                  type="button"
                  class="document-close-recover"
                  onClick={() => {
                    cancelDocumentClose();
                    setRecoverDialogOpen(true);
                  }}
                >
                  Recover an earlier repertoire
                </button>
                <button
                  disabled={savingDocumentClose()}
                  onClick={() => void saveAndContinueDocumentClose()}
                >
                  Save to file first
                </button>
                <button disabled={savingDocumentClose()} onClick={continueDocumentClose}>
                  {discardLabel[pending().intent]}
                </button>
              </Show>
            </div>
          </Dialog>
        );
      }}
    </Show>
  );
}
