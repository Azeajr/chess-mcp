/**
 * Settings drawer: OpenRouter API key + model slug (persisted to localStorage by the settings
 * store). The key is stored in plaintext — noted to the user.
 */
import { Show } from "solid-js";
import { settingsOpen, setSettingsOpen } from "../store/ui";
import { apiKey, model, setApiKey, setModel } from "../store/settings";

export default function SettingsDrawer() {
  return (
    <Show when={settingsOpen()}>
      <div class="drawer-backdrop" onClick={() => setSettingsOpen(false)}>
        <div class="drawer" onClick={(e) => e.stopPropagation()}>
          <div class="drawer-head">
            <span>Settings</span>
            <button onClick={() => setSettingsOpen(false)}>✕</button>
          </div>

          <label class="field">
            <span>OpenRouter API key</span>
            <input
              type="password"
              placeholder="sk-or-…"
              value={apiKey()}
              onInput={(e) => setApiKey(e.currentTarget.value)}
            />
            <small>Stored in localStorage (plaintext). Used for in-app chat only.</small>
          </label>

          <label class="field">
            <span>Model</span>
            <input
              type="text"
              list="model-slugs"
              placeholder="anthropic/claude-sonnet-4.5"
              value={model()}
              onChange={(e) => setModel(e.currentTarget.value)}
            />
            <datalist id="model-slugs">
              <option value="anthropic/claude-sonnet-4.5" />
              <option value="anthropic/claude-opus-4.1" />
              <option value="openai/gpt-5" />
              <option value="google/gemini-2.5-pro" />
              <option value="deepseek/deepseek-v4-flash" />
              <option value="meta-llama/llama-4-maverick" />
              <option value="x-ai/grok-4" />
              <option value="qwen/qwen3-max" />
            </datalist>
            <small>
              Any OpenRouter model slug, e.g. <code>anthropic/claude-sonnet-4.5</code>,{" "}
              <code>openai/gpt-5</code>, <code>google/gemini-2.5-pro</code>,{" "}
              <code>deepseek/deepseek-v4-flash</code>. See openrouter.ai/models.
            </small>
          </label>
        </div>
      </div>
    </Show>
  );
}
