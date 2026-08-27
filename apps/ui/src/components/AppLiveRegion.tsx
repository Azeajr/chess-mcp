/**
 * WP-009 — the app-root live regions. One polite region and one assertive region, mounted in
 * `App.tsx` outside `.app-main` so they are never inside a subtree that receives `inert` (the
 * same reason overlays render there). The only writer is `store/announce.ts`.
 *
 * `data-app-live-region` is the test/evidence hook: the e2e baseline check and the AG-5 AT
 * scenario both read the regions' text content through it.
 *
 * The assertive region keeps `role="alert"` on its message paragraph, but the polite region does
 * NOT carry `role="status"`: `aria-live="polite"` already makes it a live region, and a second
 * `role="status"` in the document makes every existing bare `getByRole("status")` lookup — and the
 * equivalent AT navigation — ambiguous with real page content such as the file notice.
 *
 * The assertive *container* carries no `aria-live`: `role="alert"` on the paragraph already implies
 * `aria-live="assertive"`, so declaring both nested a live region inside a live region. Real-AT
 * evidence (run 33031997201) showed NVDA speaking one failure three times — violating WP-009's
 * "exactly one message per policy event" policy — while VoiceOver dropped the update entirely.
 */
import { Show } from "solid-js";
import { assertiveMessage, politeMessage } from "../store/announce";

export default function AppLiveRegion() {
  return (
    <div class="app-live-regions">
      <div data-app-live-region="polite" aria-live="polite" class="sr-only">
        <Show when={politeMessage()}>{(announcement) => <p>{announcement().message}</p>}</Show>
      </div>
      <div data-app-live-region="assertive" class="sr-only">
        <Show when={assertiveMessage()}>
          {(announcement) => <p role="alert">{announcement().message}</p>}
        </Show>
      </div>
    </div>
  );
}
