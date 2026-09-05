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
