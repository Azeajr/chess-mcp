/**
 * ChatPanel: converse with the model about the current position. Streams responses, shows the
 * tools it called as chips, surfaces errors. Position context is injected automatically by the
 * chat store. Proposed lines land in the AnalysisPanel (Suggestions) + as blue board arrows.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { history, streamingText, busy, error, send, clearChat, stop, retry, toolRuns } from "../store/chat";
import { hasApiKey, chatMode, setChatMode } from "../store/settings";
import { setSettingsOpen } from "../store/ui";
import { actions } from "../store/game";
import type { ChatMessage } from "../llm/openrouter";
import { CHAT_MODES, type ChatMode } from "../llm/workflows";
import ToolResult from "./ToolResult";

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
          class="chat-mode"
          title="Optional workflow guidance; all tools remain available"
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
              <Show when={m.role === "focus"}>
                <div
                  class="msg focus-injection"
                  onClick={() => m.focusPath && actions.goto(m.focusPath)}
                  title="Jump to this line"
                >
                  🔍 {m.content}
                </div>
              </Show>
              <Show when={m.role === "assistant" && m.content?.trim()}>
                <div class="msg assistant">{m.content}</div>
              </Show>
              <Show when={m.role === "assistant" && m.tool_calls}>
                <div class="tool-chips">
                  <For each={m.tool_calls}>{(tc) => <span class="chip">⚙ {tc.function.name}</span>}</For>
                </div>
              </Show>
              <Show when={m.role === "tool" && m.tool_call_id}>
                <div class={`tool-result${isErrorResult(m.content) ? " tool-result-error" : ""}`}>
                  <div class="tool-result-label">
                    {toolNames().get(m.tool_call_id!) ?? "tool"} result
                    {isErrorResult(m.content) ? " ⚠" : ""}
                  </div>
                  <ToolResult operation={toolNames().get(m.tool_call_id!) ?? "tool"} content={m.content} />
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
        <For each={toolRuns()}>
          {(run) => (
            <div class={`tool-run ${run.status}`}>
              <span class="tool-run-state">{run.status}</span> {run.name}
              <Show when={run.total != null}><span> {run.done ?? 0}/{run.total}</span></Show>
              <Show when={run.detail}><span class="tool-run-detail"> — {run.detail}</span></Show>
            </div>
          )}
        </For>
      </div>

      <Show when={error()}>
        <div class="chat-error">{error()} <Show when={!busy()}><button class="chat-retry" onClick={retry}>Retry</button></Show></div>
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
          placeholder="Ask about this position, game, or repertoire…"
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
        <Show when={!busy()} fallback={<button class="stop-btn" onClick={stop}>Stop</button>}>
          <button onClick={submit}>Send</button>
        </Show>
      </div>
    </div>
  );
}
