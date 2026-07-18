import { For, createSignal } from "solid-js";
import type {
  StrategicFitProfileMode,
  StrategicFitProfilePreferences,
} from "@chess-mcp/chess-tools";
import {
  completeStrategicFitProfileSetup,
  skipStrategicFitProfileSetup,
} from "../../store/strategic-fit-profile-setup";
import { strategicFitProfile } from "../../store/strategic-fit-profile";

export const STRATEGIC_FIT_PROFILE_LABELS: Readonly<Record<StrategicFitProfileMode, string>> = {
  "familiar-plans": "Familiar plans",
  balanced: "Balanced",
  versatile: "Versatile",
  custom: "Custom",
};

const PROFILE_OPTIONS: readonly {
  mode: StrategicFitProfileMode;
  description: string;
  recommended?: boolean;
}[] = [
  {
    mode: "familiar-plans",
    description: "Prefer fewer unique structures and plans, accepting less variety to reduce learning load.",
  },
  {
    mode: "balanced",
    description: "Keep the repertoire familiar without giving up practical choices unnecessarily.",
    recommended: true,
  },
  {
    mode: "versatile",
    description: "Preserve more strategic diversity, accepting more structures and plans to remember.",
  },
  {
    mode: "custom",
    description: "Set your own review priorities and tolerances in Advanced preferences.",
  },
];

function clonePreferences(preferences: StrategicFitProfilePreferences): StrategicFitProfilePreferences {
  return {
    ...preferences,
    preferred_concept_ids: [...preferences.preferred_concept_ids],
    avoided_concept_ids: [...preferences.avoided_concept_ids],
    preferred_tactical_character: [...preferences.preferred_tactical_character],
  };
}

function listValue(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function optionalNumber(value: string, scale = 1): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / scale : null;
}

export default function ProfileSetup() {
  const initial = strategicFitProfile();
  const [selectedMode, setSelectedMode] = createSignal<StrategicFitProfileMode>(initial.mode);
  const [preferences, setPreferences] = createSignal(clonePreferences(initial.preferences));
  const [advancedOpen, setAdvancedOpen] = createSignal(initial.mode === "custom");

  const chooseMode = (mode: StrategicFitProfileMode) => {
    setSelectedMode(mode);
    if (mode === "custom") setAdvancedOpen(true);
  };
  const updatePreference = <K extends keyof StrategicFitProfilePreferences>(
    key: K,
    value: StrategicFitProfilePreferences[K],
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    chooseMode("custom");
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const mode = selectedMode();
    completeStrategicFitProfileSetup(mode, mode === "custom" ? preferences() : undefined);
  };

  return (
    <main class="strategic-fit-profile-setup" aria-labelledby="strategic-fit-profile-setup-title">
      <form onSubmit={submit}>
        <div class="strategic-fit-profile-setup-intro">
          <div class="strategic-fit-workspace-kicker">First-run setup</div>
          <h2 id="strategic-fit-profile-setup-title">How should Strategic Fit review your repertoire?</h2>
          <p id="strategic-fit-profile-setup-description">
            Choose the tradeoff that best matches how you want to learn. Balanced is the recommended
            starting point, and you can change these profile settings later.
          </p>
        </div>

        <fieldset class="strategic-fit-profile-options" aria-describedby="strategic-fit-profile-setup-description">
          <legend class="sr-only">Review profile</legend>
          <For each={PROFILE_OPTIONS}>{(option) => (
            <label class={`strategic-fit-profile-option${selectedMode() === option.mode ? " selected" : ""}`}>
              <input
                type="radio"
                name="strategic-fit-profile"
                value={option.mode}
                checked={selectedMode() === option.mode}
                onChange={() => chooseMode(option.mode)}
              />
              <span>
                <strong>{STRATEGIC_FIT_PROFILE_LABELS[option.mode]}</strong>
                {option.recommended && <span class="strategic-fit-recommended">Recommended</span>}
                <span class="strategic-fit-profile-option-description">{option.description}</span>
              </span>
            </label>
          )}</For>
        </fieldset>

        <div class="strategic-fit-profile-engine-note" role="note">
          <strong>The base scan is engine-free.</strong> Engine depth is used only later when
          comparing alternatives or replacements, never for the initial structural scan.
        </div>

        <details
          class="strategic-fit-profile-advanced"
          open={advancedOpen()}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>Advanced preferences</summary>
          <p class="strategic-fit-profile-advanced-help">
            Changing an advanced preference selects Custom. Values are bounded to the supported
            range and saved as profile metadata only.
          </p>

          <div class="strategic-fit-profile-fields">
            <label>
              <span>Maximum acceptable engine loss</span>
              <span class="strategic-fit-field-help" id="strategic-fit-engine-loss-help">
                Optional centipawn limit, from 0 to 1000, for later alternative comparisons.
              </span>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={preferences().maximum_engine_loss_cp ?? ""}
                aria-describedby="strategic-fit-engine-loss-help"
                placeholder="No limit"
                onInput={(event) => updatePreference(
                  "maximum_engine_loss_cp",
                  optionalNumber(event.currentTarget.value),
                )}
              />
            </label>

            <label>
              <span>Opponent popularity importance</span>
              <span class="strategic-fit-field-help">How strongly common opponent choices should influence review.</span>
              <div class="strategic-fit-range-row">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={preferences().opponent_popularity_importance}
                  onInput={(event) => updatePreference(
                    "opponent_popularity_importance",
                    Number(event.currentTarget.value),
                  )}
                />
                <output>{preferences().opponent_popularity_importance.toFixed(2)}</output>
              </div>
            </label>

            <label>
              <span>Personal-game importance</span>
              <span class="strategic-fit-field-help">How strongly positions from your own games should influence review.</span>
              <div class="strategic-fit-range-row">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={preferences().personal_game_frequency_importance}
                  onInput={(event) => updatePreference(
                    "personal_game_frequency_importance",
                    Number(event.currentTarget.value),
                  )}
                />
                <output>{preferences().personal_game_frequency_importance.toFixed(2)}</output>
              </div>
            </label>

            <label>
              <span>Manual weighting importance</span>
              <span class="strategic-fit-field-help">How strongly your existing manual route weights should influence review.</span>
              <div class="strategic-fit-range-row">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={preferences().manual_weight_importance}
                  onInput={(event) => updatePreference(
                    "manual_weight_importance",
                    Number(event.currentTarget.value),
                  )}
                />
                <output>{preferences().manual_weight_importance.toFixed(2)}</output>
              </div>
            </label>

            <label>
              <span>Additional memorization tolerance</span>
              <span class="strategic-fit-field-help">0 favors less study; 1 accepts the most additional material.</span>
              <div class="strategic-fit-range-row">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={preferences().additional_memorization_tolerance}
                  onInput={(event) => updatePreference(
                    "additional_memorization_tolerance",
                    Number(event.currentTarget.value),
                  )}
                />
                <output>{preferences().additional_memorization_tolerance.toFixed(2)}</output>
              </div>
            </label>

            <label>
              <span>Minimum opponent coverage</span>
              <span class="strategic-fit-field-help" id="strategic-fit-coverage-help">
                Optional percentage from 0 to 100 of opponent choices to cover.
              </span>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={preferences().minimum_opponent_coverage === null
                  ? ""
                  : Math.round(preferences().minimum_opponent_coverage! * 100)}
                aria-describedby="strategic-fit-coverage-help"
                placeholder="No minimum"
                onInput={(event) => updatePreference(
                  "minimum_opponent_coverage",
                  optionalNumber(event.currentTarget.value, 100),
                )}
              />
            </label>

            <label>
              <span>Preferred concepts</span>
              <span class="strategic-fit-field-help">Comma-separated concept identifiers or names.</span>
              <input
                type="text"
                value={preferences().preferred_concept_ids.join(", ")}
                onInput={(event) => updatePreference("preferred_concept_ids", listValue(event.currentTarget.value))}
              />
            </label>

            <label>
              <span>Avoided concepts</span>
              <span class="strategic-fit-field-help">Comma-separated concept identifiers or names.</span>
              <input
                type="text"
                value={preferences().avoided_concept_ids.join(", ")}
                onInput={(event) => updatePreference("avoided_concept_ids", listValue(event.currentTarget.value))}
              />
            </label>

            <label>
              <span>Preferred tactical character</span>
              <span class="strategic-fit-field-help">Comma-separated traits such as forcing, sharp, or quiet.</span>
              <input
                type="text"
                value={preferences().preferred_tactical_character.join(", ")}
                onInput={(event) => updatePreference(
                  "preferred_tactical_character",
                  listValue(event.currentTarget.value),
                )}
              />
            </label>
          </div>
        </details>

        <div class="strategic-fit-profile-setup-footer">
          <p>
            Choosing a profile saves review preferences only. It does not edit the repertoire or
            start analysis. Skipping keeps a visible, provisional inferred profile for this session
            and does not save that inference.
          </p>
          <div class="strategic-fit-profile-setup-actions">
            <button type="button" class="secondary" onClick={() => skipStrategicFitProfileSetup()}>
              Skip for now
            </button>
            <button type="submit" class="primary">
              Use {STRATEGIC_FIT_PROFILE_LABELS[selectedMode()]} profile
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
