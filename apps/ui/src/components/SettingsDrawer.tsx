/**
 * Settings drawer: OpenRouter API key, model slug, and Lichess API token (persisted to
 * localStorage by the settings store). The keys are stored in plaintext — noted to the user.
 */
import { createEffect, For, Show } from "solid-js";
import { settingsOpen, setSettingsOpen } from "../store/ui";
import Dialog from "./primitives/Dialog";
import {
  apiKey,
  model,
  setApiKey,
  setModel,
  lichessToken,
  setLichessToken,
  MODEL_SUGGESTIONS,
  settingsFocusTarget,
  setSettingsFocusTarget,
} from "../store/settings";
import Field from "./primitives/Field";
import { setRecoverDialogOpen, snapshotsUnavailable } from "../store/persist";

export default function SettingsDrawer() {
  // WP-026 AC-4: a recovery action can request focus land on the token field.
  let tokenInput: HTMLInputElement | undefined;
  // Focus lands after the dialog mounts and its own initial focus runs, hence the rAF.
  createEffect(() => {
    if (!settingsOpen() || settingsFocusTarget() !== "lichess-token") return;
    requestAnimationFrame(() => tokenInput?.focus());
  });
  return (
    <Show when={settingsOpen()}>
      <Dialog
        title="Settings"
        size="drawer"
        class="drawer"
        dismissOnBackdrop
        initialFocus={
          settingsFocusTarget() === "lichess-token"
            ? "input[data-settings-field='lichess-token']"
            : undefined
        }
        onClose={() => {
          setSettingsOpen(false);
          setSettingsFocusTarget(null);
        }}
      >
        <button
          type="button"
          class="drawer-close"
          aria-label="Close settings"
          onClick={() => setSettingsOpen(false)}
        >
          ✕
        </button>

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
          <small>Pick a model below, or type any OpenRouter slug. See openrouter.ai/models.</small>
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
            ref={tokenInput}
            data-settings-field="lichess-token"
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

        {/* A label would claim the button as its control; recovery is an action, not a field. */}
        <div class="ui-field field">
          <span class="ui-field-label">Recovery</span>
          <button
            type="button"
            class="settings-recover"
            onClick={() => {
              setSettingsOpen(false);
              setRecoverDialogOpen(true);
            }}
          >
            Recover a repertoire
          </button>
          <small>Restore one of the last five working documents saved in this browser.</small>
          <Show when={snapshotsUnavailable()}>
            <small class="document-close-error" role="alert">
              Snapshot history unavailable. Your current repertoire is still autosaved.
            </small>
          </Show>
        </div>
      </Dialog>
    </Show>
  );
}
