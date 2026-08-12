/**
 * Settings drawer: OpenRouter API key, model slug, and Lichess API token (persisted to
 * localStorage by the settings store). The keys are stored in plaintext — noted to the user.
 */
import { createEffect, For, Show } from "solid-js";
import {
  settingsFocusTarget,
  settingsOpen,
  setSettingsFocusTarget,
  setSettingsOpen,
} from "../store/ui";
import {
  apiKey,
  model,
  setApiKey,
  setModel,
  lichessToken,
  setLichessToken,
  setShowTechnicalDetails,
  showTechnicalDetails,
  MODEL_SUGGESTIONS,
} from "../store/settings";
import Field from "./primitives/Field";

export default function SettingsDrawer() {
  createEffect(() => {
    if (!settingsOpen() || settingsFocusTarget() !== "lichess-token") return;
    requestAnimationFrame(() => {
      const input = document.getElementById("settings-lichess-token");
      if (input instanceof HTMLInputElement) {
        input.focus();
        setSettingsFocusTarget(null);
      }
    });
  });

  return (
    <Show when={settingsOpen()}>
      <div class="drawer-backdrop" onClick={() => setSettingsOpen(false)}>
        <div
          class="drawer"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <div class="drawer-head">
            <span>Settings</span>
            <button onClick={() => setSettingsOpen(false)}>✕</button>
          </div>

          <Field class="field" label="OpenRouter API key">
            <input
              type="password"
              placeholder="sk-or-…"
              value={apiKey()}
              onInput={(e) => {
                setApiKey(e.currentTarget.value);
              }}
            />
            <small>Stored in localStorage (plaintext). Used for in-app chat only.</small>
          </Field>

          <Field class="field" label="Model">
            <input
              type="text"
              placeholder="deepseek/deepseek-v4-flash"
              value={model()}
              onChange={(e) => {
                setModel(e.currentTarget.value);
              }}
            />
            <small>
              Pick a model below, or type any OpenRouter slug. See openrouter.ai/models.
            </small>
            <div class="model-chips">
              <For each={MODEL_SUGGESTIONS}>
                {(m) => (
                  <button
                    type="button"
                    class={`model-chip${model() === m.slug ? " active" : ""}`}
                    title={m.slug}
                    onClick={() => {
                      setModel(m.slug);
                    }}
                  >
                    {m.label}
                  </button>
                )}
              </For>
            </div>
          </Field>

          <Field class="field" label="Lichess API token">
            <input
              id="settings-lichess-token"
              type="password"
              placeholder="lip_…"
              value={lichessToken()}
              onInput={(e) => {
                setLichessToken(e.currentTarget.value);
              }}
            />
            <small>
              Personal token, no scopes needed — lichess.org/account/oauth/token. Enables the
              opening-explorer tools (position popularity, theory depth, gap popularity). Stored in
              localStorage (plaintext).
            </small>
          </Field>

          <Field class="field field-toggle" label="Display">
            <input
              type="checkbox"
              aria-label="Show technical details"
              checked={showTechnicalDetails()}
              onChange={(e) => {
                setShowTechnicalDetails(e.currentTarget.checked);
              }}
            />
            <span>Show technical details</span>
            <small>Show raw command payloads and error codes in chat.</small>
          </Field>
        </div>
      </div>
    </Show>
  );
}
