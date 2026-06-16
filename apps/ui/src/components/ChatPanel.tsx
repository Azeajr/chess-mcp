/**
 * ChatPanel: converse with the model about the current position. Streams responses, shows the
 * tools it called as chips, surfaces errors. Position context is injected automatically by the
 * chat store. Proposed lines land in the AnalysisPanel (Suggestions) + as blue board arrows.
 */
import { For, Show, createSignal } from "solid-js";
import { history, streamingText, busy, error, send, clearChat } from "../store/chat";
import { hasApiKey } from "../store/settings";
import { setSettingsOpen } from "../store/ui";

export default function ChatPanel() {
  const [input, setInput] = createSignal("");

  const submit = () => {
    const text = input();
    if (!text.trim()) return;
    setInput("");
    void send(text);
  };

  return (
    <div class="chat">
      <div class="panel-head">
        <span>Chat</span>
        <button class="scan-btn" onClick={clearChat}>
          Clear
        </button>
      </div>

      <div class="chat-log">
        <For each={history()}>
          {(m) => (
            <>
              <Show when={m.role === "user"}>
                <div class="msg user">{m.content}</div>
              </Show>
              <Show when={m.role === "assistant" && m.content}>
                <div class="msg assistant">{m.content}</div>
              </Show>
              <Show when={m.role === "assistant" && m.tool_calls}>
                <div class="tool-chips">
                  <For each={m.tool_calls}>{(tc) => <span class="chip">⚙ {tc.function.name}</span>}</For>
                </div>
              </Show>
            </>
          )}
        </For>
        <Show when={streamingText()}>
          <div class="msg assistant streaming">{streamingText()}</div>
        </Show>
        <Show when={busy() && !streamingText()}>
          <div class="msg assistant streaming">…</div>
        </Show>
      </div>

      <Show when={error()}>
        <div class="chat-error">{error()}</div>
      </Show>
      <Show when={!hasApiKey()}>
        <div class="chat-error">
          No API key.{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), setSettingsOpen(true))}>
            Open Settings
          </a>
        </div>
      </Show>

      <div class="chat-input">
        <textarea
          rows="2"
          placeholder="Ask about the position…"
          value={input()}
          disabled={busy()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button onClick={submit} disabled={busy()}>
          Send
        </button>
      </div>
    </div>
  );
}
