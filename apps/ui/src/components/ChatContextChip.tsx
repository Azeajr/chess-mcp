import { Show, createSignal } from "solid-js";
import { chatContextBlock, chatContextSnapshot } from "../store/chat";
import { CHAT_CONTEXT } from "../content/chat";

export default function ChatContextChip() {
  const [expanded, setExpanded] = createSignal(false);
  const snapshot = () => chatContextSnapshot();

  return (
    <div class="chat-context-chip" data-chat-context-chip>
      <button
        type="button"
        class="chat-context-summary"
        aria-expanded={expanded()}
        aria-label={expanded() ? CHAT_CONTEXT.collapseLabel : CHAT_CONTEXT.expandLabel}
        onClick={() => setExpanded(!expanded())}
      >
        <span class="chat-context-label">{CHAT_CONTEXT.label}</span>
        <span class="chat-context-values" data-chat-context-summary>
          {CHAT_CONTEXT.summary(snapshot())}
        </span>
        <span aria-hidden="true">{expanded() ? "▾" : "▸"}</span>
      </button>
      <Show when={expanded()}>
        <pre class="chat-context-block" data-chat-context-block>
          {chatContextBlock(snapshot())}
        </pre>
      </Show>
    </div>
  );
}
