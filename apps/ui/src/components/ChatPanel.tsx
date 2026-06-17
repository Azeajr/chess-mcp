/**
 * ChatPanel: converse with the model about the current position. Streams responses, shows the
 * tools it called as chips, surfaces errors. Position context is injected automatically by the
 * chat store. Proposed lines land in the AnalysisPanel (Suggestions) + as blue board arrows.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { history, streamingText, busy, error, send, clearChat } from "../store/chat";
import { hasApiKey, chatMode, setChatMode } from "../store/settings";
import { setSettingsOpen } from "../store/ui";
import type { ChatMessage } from "../llm/openrouter";
import { CHAT_MODES, type ChatMode } from "../llm/workflows";

function buildToolNameMap(msgs: ChatMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of msgs) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) map.set(tc.id, tc.function.name);
    }
  }
  return map;
}

function isErrorResult(content: string | null): boolean {
  if (!content) return false;
  try {
    const v = JSON.parse(content) as unknown;
    return typeof v === "object" && v !== null && "error" in v;
  } catch {
    return false;
  }
}

export default function ChatPanel() {
  const [input, setInput] = createSignal("");

  const toolNames = createMemo(() => buildToolNameMap(history()));

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
        <select
          class={`chat-mode${chatMode() ? "" : " needs-mode"}`}
          title="Workflow: tells the assistant which tools to use, in what order, for this kind of task"
          value={chatMode()}
          onChange={(e) => setChatMode(e.currentTarget.value as ChatMode)}
        >
          <For each={CHAT_MODES}>{(m) => <option value={m.id}>{m.label}</option>}</For>
        </select>
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
              <Show when={m.role === "assistant" && m.raw_response}>
                <details class="raw-response">
                  <summary>raw assistant response</summary>
                  <pre>{m.raw_response}</pre>
                </details>
              </Show>
              <Show when={m.role === "assistant" && m.tool_calls}>
                <div class="tool-chips">
                  <For each={m.tool_calls}>{(tc) => <span class="chip">⚙ {tc.function.name}</span>}</For>
                </div>
              </Show>
              <Show when={m.role === "tool" && m.tool_call_id}>
                <details class={`tool-result${isErrorResult(m.content) ? " tool-result-error" : ""}`}>
                  <summary>
                    {toolNames().get(m.tool_call_id!) ?? "tool"} result
                    {isErrorResult(m.content) ? " ⚠" : ""}
                  </summary>
                  <pre>{m.content}</pre>
                </details>
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
      <Show when={hasApiKey() && !chatMode()}>
        <div class="chat-hint">Select a mode before sending.</div>
      </Show>

      <div class="chat-input">
        <textarea
          rows="2"
          placeholder={chatMode() ? "Ask about the position…" : "Select a mode first…"}
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
