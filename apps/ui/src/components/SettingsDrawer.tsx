/**
 * Settings drawer: OpenRouter API key, model slug, and Lichess API token (persisted to
 * localStorage by the settings store). The keys are stored in plaintext — noted to the user.
 */
import { For, Show } from "solid-js";
import { settingsOpen, setSettingsOpen } from "../store/ui";
import {
  apiKey,
  model,
  setApiKey,
  setModel,
  lichessToken,
  setLichessToken,
  cloudEvalEnabled,
  setCloudEvalEnabled,
  MODEL_SUGGESTIONS,
} from "../store/settings";

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
              placeholder="deepseek/deepseek-v4-flash"
              value={model()}
              onChange={(e) => setModel(e.currentTarget.value)}
            />
            <small>Pick a model below, or type any OpenRouter slug. See openrouter.ai/models.</small>
            <div class="model-chips">
              <For each={MODEL_SUGGESTIONS}>
                {(m) => (
                  <button
                    type="button"
                    class={`model-chip${model() === m.slug ? " active" : ""}`}
                    title={m.slug}
                    onClick={() => setModel(m.slug)}
                  >
                    {m.label}
                  </button>
                )}
              </For>
            </div>
          </label>

          <label class="field">
            <span>Lichess API token</span>
            <input
              type="password"
              placeholder="lip_…"
              value={lichessToken()}
              onInput={(e) => setLichessToken(e.currentTarget.value)}
            />
            <small>
              Personal token, no scopes needed — lichess.org/account/oauth/token. Enables the
              opening-explorer tools (position popularity, theory depth, gap popularity). Stored
              in localStorage (plaintext).
            </small>
          </label>

          <label class="field field-toggle">
            <span>Lichess cloud eval</span>
            <input
              type="checkbox"
              checked={cloudEvalEnabled()}
              onChange={(e) => setCloudEvalEnabled(e.currentTarget.checked)}
            />
            <small>
              Sends each browsed position (FEN only) to Lichess for a cloud second opinion. Turn
              off to keep prep lines fully on this machine — local Stockfish is unaffected.
            </small>
          </label>
        </div>
      </div>
    </Show>
  );
}
