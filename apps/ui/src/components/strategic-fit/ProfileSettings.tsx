import { For, Show, createMemo, createSignal } from "solid-js";
import {
  EXPLORER_RATING_BUCKETS,
  EXPLORER_SPEEDS,
  STRATEGIC_SIGNAL_FAMILIES,
  type StrategicFitProfileMode,
  type StrategicFitProfilePreferences,
  type StrategicSignalFamily,
} from "@chess-mcp/chess-tools";
import { lichessToken } from "../../store/settings";
import {
  selectStrategicFitProfile,
  strategicFitProfile,
  updateCustomStrategicFitProfile,
} from "../../store/strategic-fit-profile";
import {
  strategicFitDataSourceSettings,
  updateStrategicFitDataSourceSettings,
  type StrategicFitDataSourceSettings,
} from "../../store/strategic-fit-data-sources";
import {
  strategicFitTrainingPerformance,
  exportStrategicFitTrainingPerformance,
  importStrategicFitTrainingPerformance,
} from "../../store/strategic-fit-training";
import { strategicFitLifecycle } from "../../store/strategic-fit";
import { saveArtifact } from "../../store/artifacts";
import { STRATEGIC_FIT_PROFILE_LABELS } from "./ProfileSetup";
import { STRATEGIC_FIT_VOCABULARY } from "../../content/strategicFit";

const PRESETS: readonly Exclude<StrategicFitProfileMode, "custom">[] = [
  "familiar-plans",
  "balanced",
  "versatile",
];

const FAMILY_LABELS: Readonly<Record<StrategicSignalFamily, string>> = {
  "pawn-topology": "Pawn structure",
  "center-dynamics": "Center dynamics",
  "king-and-piece-setup": "King and piece setup",
  "space-and-files": "Space and open files",
  "dynamic-character": "Dynamic character",
  "learning-concepts": "Learning concepts",
};

function clonePreferences(
  preferences: StrategicFitProfilePreferences,
): StrategicFitProfilePreferences {
  return {
    ...preferences,
    preferred_concept_ids: [...preferences.preferred_concept_ids],
    avoided_concept_ids: [...preferences.avoided_concept_ids],
    preferred_tactical_character: [...preferences.preferred_tactical_character],
    feature_family_weights: { ...preferences.feature_family_weights },
  };
}

function cloneSources(settings: StrategicFitDataSourceSettings): StrategicFitDataSourceSettings {
  return {
    popularity: {
      ...settings.popularity,
      speeds: [...settings.popularity.speeds],
      ratings: [...settings.popularity.ratings],
    },
    personal_history: { ...settings.personal_history },
  };
}

const list = (value: string): string[] => [
  ...new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ),
];

const optionalNumber = (value: string, scale = 1): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / scale : null;
};

export default function ProfileSettings() {
  const [open, setOpen] = createSignal(false);
  const [preferences, setPreferences] = createSignal(
    clonePreferences(strategicFitProfile().preferences),
  );
  const [sources, setSources] = createSignal(cloneSources(strategicFitDataSourceSettings()));
  const [announcement, setAnnouncement] = createSignal("");
  const [trainingTransferMessage, setTrainingTransferMessage] = createSignal<string | null>(null);

  const exportTraining = () => {
    const result = exportStrategicFitTrainingPerformance();
    if (result.artifact_id !== null) saveArtifact(result.artifact_id);
    setTrainingTransferMessage(result.message);
  };

  const importTraining = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setTrainingTransferMessage(importStrategicFitTrainingPerformance(parsed).message);
    } catch {
      setTrainingTransferMessage("That file is not valid JSON.");
    }
  };

  const resetDraft = () => {
    setPreferences(clonePreferences(strategicFitProfile().preferences));
    setSources(cloneSources(strategicFitDataSourceSettings()));
    setAnnouncement("");
  };
  const toggle = () => {
    if (!open()) resetDraft();
    setOpen(!open());
  };
  const updatePreference = <K extends keyof StrategicFitProfilePreferences>(
    key: K,
    value: StrategicFitProfilePreferences[K],
  ) => setPreferences((current) => ({ ...current, [key]: value }));
  const updateFamilyWeight = (family: StrategicSignalFamily, value: number) =>
    setPreferences((current) => ({
      ...current,
      feature_family_weights: { ...current.feature_family_weights, [family]: value },
    }));

  const changed = createMemo(
    () =>
      JSON.stringify(preferences()) !== JSON.stringify(strategicFitProfile().preferences) ||
      JSON.stringify(sources()) !== JSON.stringify(strategicFitDataSourceSettings()),
  );
  const impact = createMemo(() => {
    if (!changed()) return ["No unsaved changes. Current report inputs stay unchanged."];
    const messages: string[] = [];
    const before = strategicFitProfile().preferences;
    const next = preferences();
    if (
      JSON.stringify(before.feature_family_weights) !== JSON.stringify(next.feature_family_weights)
    ) {
      messages.push(
        "Strategic distance, cohort coherence, and finding priorities will be recalculated.",
      );
    }
    if (
      before.opponent_popularity_importance !== next.opponent_popularity_importance ||
      before.personal_game_frequency_importance !== next.personal_game_frequency_importance ||
      before.manual_weight_importance !== next.manual_weight_importance ||
      JSON.stringify(sources()) !== JSON.stringify(strategicFitDataSourceSettings())
    )
      messages.push(
        "Expected frequency and every frequency-weighted metric will be recalculated from the selected evidence.",
      );
    if (before.additional_memorization_tolerance !== next.additional_memorization_tolerance) {
      messages.push(
        "Training-adjusted workload, exception cost, and repertoire regret will change where training evidence exists.",
      );
    }
    if (
      JSON.stringify(before.preferred_concept_ids) !== JSON.stringify(next.preferred_concept_ids) ||
      JSON.stringify(before.avoided_concept_ids) !== JSON.stringify(next.avoided_concept_ids) ||
      JSON.stringify(before.preferred_tactical_character) !==
        JSON.stringify(next.preferred_tactical_character)
    )
      messages.push("Target-profile explanations will use the updated explicit concept intent.");
    if (
      before.maximum_engine_loss_cp !== next.maximum_engine_loss_cp ||
      before.minimum_opponent_coverage !== next.minimum_opponent_coverage
    )
      messages.push(
        "Evaluation and coverage constraints are saved for later alternative checks; the engine-free base metrics do not fabricate an effect.",
      );
    return messages;
  });

  const sourceStatus = createMemo(() => {
    const settings = sources();
    const reportSources = changed()
      ? []
      : (strategicFitLifecycle().current_result?.result.provenance.sources ?? []);
    const actual = (kind: "opening-explorer" | "personal-history" | "training-metadata") =>
      reportSources.find((source) => source.kind === kind);
    const populationEvidence = actual("opening-explorer");
    const historyEvidence = actual("personal-history");
    const trainingEvidence = actual("training-metadata");
    const popularity: readonly [string, string] = !settings.popularity.enabled
      ? ["Off", "Enable to weight common opponent choices."]
      : populationEvidence
        ? [
            populationEvidence.state === "available"
              ? "Available"
              : populationEvidence.state.charAt(0).toUpperCase() +
                populationEvidence.state.slice(1),
            populationEvidence.reason ?? "Latest report source state.",
          ]
        : !lichessToken()
          ? ["Unavailable", "Add a Lichess token in Settings before analysis."]
          : [
              "Ready",
              `${settings.popularity.db === "masters" ? "Masters" : "Online population"} filters will be used.`,
            ];
    const history: readonly [string, string] = !settings.personal_history.enabled
      ? ["Off", "Enable to blend your own game frequency."]
      : historyEvidence
        ? [
            historyEvidence.state === "available"
              ? "Available"
              : historyEvidence.state.charAt(0).toUpperCase() + historyEvidence.state.slice(1),
            historyEvidence.reason ?? "Latest report source state.",
          ]
        : !settings.personal_history.username
          ? ["Unavailable", "Enter a username to use personal history."]
          : [
              "Ready",
              `${settings.personal_history.platform === "lichess" ? "Lichess" : "Chess.com"} history is configured.`,
            ];
    const trained = strategicFitTrainingPerformance().targets.length;
    return [
      {
        label: "Repertoire and classifiers",
        state: "Ready",
        detail: "Local deterministic evidence is always available.",
      },
      { label: "Opening popularity", state: popularity[0], detail: popularity[1] },
      { label: "Personal history", state: history[0], detail: history[1] },
      {
        label: "Training performance",
        state: trainingEvidence
          ? trainingEvidence.state === "available"
            ? "Available"
            : trainingEvidence.state.charAt(0).toUpperCase() + trainingEvidence.state.slice(1)
          : trained > 0
            ? "Ready"
            : "No observations",
        detail:
          trainingEvidence?.reason ??
          (trained > 0
            ? `${trained} saved training target${trained === 1 ? "" : "s"}.`
            : "Missing training is not counted as poor mastery."),
      },
    ];
  });

  const save = () => {
    if (Object.values(preferences().feature_family_weights).every((weight) => weight === 0)) {
      setAnnouncement("At least one feature-family weight must be greater than zero.");
      return;
    }
    updateCustomStrategicFitProfile(preferences());
    updateStrategicFitDataSourceSettings(sources());
    setAnnouncement(
      "Custom profile and data sources saved. Cached reports were invalidated; the repertoire tree was not edited.",
    );
  };

  return (
    <section class="strategic-fit-settings" aria-labelledby="strategic-fit-settings-title">
      <div class="strategic-fit-settings-summary">
        <div>
          <span class="strategic-fit-workspace-kicker">Review settings</span>
          <h2 id="strategic-fit-settings-title">Profile and evidence</h2>
        </div>
        <div class="strategic-fit-preset-actions" aria-label="Profile presets">
          <For each={PRESETS}>
            {(mode) => (
              <button
                type="button"
                class={strategicFitProfile().mode === mode ? "active" : ""}
                aria-pressed={strategicFitProfile().mode === mode}
                onClick={() => {
                  selectStrategicFitProfile(mode);
                  resetDraft();
                  setAnnouncement(
                    `${STRATEGIC_FIT_PROFILE_LABELS[mode]} profile applied. The repertoire tree was not edited.`,
                  );
                }}
              >
                {STRATEGIC_FIT_PROFILE_LABELS[mode]}
              </button>
            )}
          </For>
          <button
            type="button"
            aria-expanded={open()}
            aria-controls={open() ? "strategic-fit-custom-settings" : undefined}
            onClick={toggle}
          >
            {open() ? "Close custom settings" : "Customize"}
          </button>
        </div>
      </div>

      <Show when={open()}>
        <div id="strategic-fit-custom-settings" class="strategic-fit-settings-body">
          <details open>
            <summary>Strategic priorities</summary>
            <p class="strategic-fit-profile-advanced-help">
              Weights are relative: 0 ignores a family, 1 is standard, and 3 gives it the strongest
              influence. At least one must remain above zero.
            </p>
            <p class="strategic-fit-profile-advanced-help" data-strategic-distance-definition>
              {STRATEGIC_FIT_VOCABULARY.strategicDistanceDefinition}
            </p>
            <div class="strategic-fit-profile-fields strategic-fit-family-grid">
              <For each={STRATEGIC_SIGNAL_FAMILIES}>
                {(family) => (
                  <label>
                    <span>{FAMILY_LABELS[family]}</span>
                    <span class="strategic-fit-field-help">
                      Changes this family's share of explainable strategic distance and finding
                      priority.
                    </span>
                    <div class="strategic-fit-range-row">
                      <input
                        type="range"
                        min="0"
                        max="3"
                        step="0.25"
                        value={preferences().feature_family_weights[family]}
                        aria-label={`${FAMILY_LABELS[family]} weight`}
                        onInput={(event) =>
                          updateFamilyWeight(family, Number(event.currentTarget.value))
                        }
                      />
                      <output>{preferences().feature_family_weights[family].toFixed(2)}</output>
                    </div>
                  </label>
                )}
              </For>
            </div>
          </details>

          <details>
            <summary>Constraints, workload, and concept intent</summary>
            <div class="strategic-fit-profile-fields">
              <label>
                <span>Evaluation tolerance</span>
                <span class="strategic-fit-field-help">
                  Maximum later alternative loss in centipawns (0–1000). It does not add an engine
                  to the base scan.
                </span>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="1"
                  placeholder="No limit"
                  value={preferences().maximum_engine_loss_cp ?? ""}
                  onInput={(event) =>
                    updatePreference(
                      "maximum_engine_loss_cp",
                      optionalNumber(event.currentTarget.value),
                    )
                  }
                />
              </label>
              <label>
                <span>Minimum opponent coverage</span>
                <span class="strategic-fit-field-help">
                  Saved coverage floor from 0–100% for later alternatives; current coverage remains
                  evidence, not a promise.
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="No minimum"
                  value={
                    preferences().minimum_opponent_coverage === null
                      ? ""
                      : Math.round((preferences().minimum_opponent_coverage ?? 0) * 100)
                  }
                  onInput={(event) =>
                    updatePreference(
                      "minimum_opponent_coverage",
                      optionalNumber(event.currentTarget.value, 100),
                    )
                  }
                />
              </label>
              <label>
                <span>Memorization tolerance</span>
                <span class="strategic-fit-field-help">
                  0 emphasizes reducing observed study burden; 1 accepts it. This scales
                  training-adjusted workload where evidence exists.
                </span>
                <div class="strategic-fit-range-row">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={preferences().additional_memorization_tolerance}
                    onInput={(event) =>
                      updatePreference(
                        "additional_memorization_tolerance",
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                  <output>{preferences().additional_memorization_tolerance.toFixed(2)}</output>
                </div>
              </label>
              <label>
                <span>Preferred concepts</span>
                <span class="strategic-fit-field-help">
                  Comma-separated explicit concepts used in target-profile explanations.
                </span>
                <input
                  type="text"
                  value={preferences().preferred_concept_ids.join(", ")}
                  onInput={(event) =>
                    updatePreference("preferred_concept_ids", list(event.currentTarget.value))
                  }
                />
              </label>
              <label>
                <span>Avoided concepts</span>
                <span class="strategic-fit-field-help">
                  Comma-separated concepts you intentionally avoid; this records intent without
                  rewriting PGN comments.
                </span>
                <input
                  type="text"
                  value={preferences().avoided_concept_ids.join(", ")}
                  onInput={(event) =>
                    updatePreference("avoided_concept_ids", list(event.currentTarget.value))
                  }
                />
              </label>
              <label>
                <span>Preferred tactical character</span>
                <span class="strategic-fit-field-help">
                  Comma-separated traits such as forcing, sharp, or quiet.
                </span>
                <input
                  type="text"
                  value={preferences().preferred_tactical_character.join(", ")}
                  onInput={(event) =>
                    updatePreference(
                      "preferred_tactical_character",
                      list(event.currentTarget.value),
                    )
                  }
                />
              </label>
            </div>
          </details>

          <details>
            <summary>Data sources and weighting</summary>
            <div class="strategic-fit-source-status" aria-label="Data-source status">
              <For each={sourceStatus()}>
                {(source) => (
                  <div>
                    <span>{source.label}</span>
                    <strong data-state={source.state.toLowerCase().replace(" ", "-")}>
                      {source.state}
                    </strong>
                    <small>{source.detail}</small>
                  </div>
                )}
              </For>
            </div>
            <div class="strategic-fit-transfer-actions">
              <button type="button" class="fix-btn" onClick={exportTraining}>
                Export training performance
              </button>
              <label class="fix-btn strategic-fit-import-label">
                Import training performance
                <input
                  aria-label="Choose Strategic Fit training performance JSON"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void importTraining(input.files?.[0]).finally(() => {
                      input.value = "";
                    });
                  }}
                />
              </label>
              <Show when={trainingTransferMessage()}>
                {(message) => <small role="status">{message()}</small>}
              </Show>
            </div>
            <div class="strategic-fit-profile-fields">
              <label>
                <span>Opponent-popularity importance</span>
                <span class="strategic-fit-field-help">
                  Controls how strongly available population evidence changes expected frequency.
                </span>
                <div class="strategic-fit-range-row">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={preferences().opponent_popularity_importance}
                    onInput={(event) =>
                      updatePreference(
                        "opponent_popularity_importance",
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                  <output>{preferences().opponent_popularity_importance.toFixed(2)}</output>
                </div>
              </label>
              <label>
                <span>Personal-history importance</span>
                <span class="strategic-fit-field-help">
                  Controls your own empirically shrunk game-frequency contribution when available.
                </span>
                <div class="strategic-fit-range-row">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={preferences().personal_game_frequency_importance}
                    onInput={(event) =>
                      updatePreference(
                        "personal_game_frequency_importance",
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                  <output>{preferences().personal_game_frequency_importance.toFixed(2)}</output>
                </div>
              </label>
              <label>
                <span>Manual-weight importance</span>
                <span class="strategic-fit-field-help">
                  Controls saved route-assessment weight; unavailable sources contribute zero.
                </span>
                <div class="strategic-fit-range-row">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={preferences().manual_weight_importance}
                    onInput={(event) =>
                      updatePreference(
                        "manual_weight_importance",
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                  <output>{preferences().manual_weight_importance.toFixed(2)}</output>
                </div>
              </label>
            </div>
            <fieldset class="strategic-fit-source-config">
              <legend>Opening popularity</legend>
              <label class="field-toggle">
                <span>Use opening-explorer popularity</span>
                <input
                  type="checkbox"
                  checked={sources().popularity.enabled}
                  onChange={(event) =>
                    setSources((current) => ({
                      ...current,
                      popularity: { ...current.popularity, enabled: event.currentTarget.checked },
                    }))
                  }
                />
              </label>
              <label>
                <span>Population</span>
                <select
                  value={sources().popularity.db}
                  onChange={(event) =>
                    setSources((current) => ({
                      ...current,
                      popularity: {
                        ...current.popularity,
                        db: event.currentTarget.value as "lichess" | "masters",
                      },
                    }))
                  }
                >
                  <option value="lichess">Broad online population</option>
                  <option value="masters">Masters</option>
                </select>
              </label>
              <label>
                <span>Maximum positions (1–120)</span>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={sources().popularity.max_positions}
                  onInput={(event) =>
                    setSources((current) => ({
                      ...current,
                      popularity: {
                        ...current.popularity,
                        max_positions: Number(event.currentTarget.value),
                      },
                    }))
                  }
                />
              </label>
              <Show when={sources().popularity.db === "lichess"}>
                <label>
                  <span>Time controls</span>
                  <span class="strategic-fit-field-help">
                    Select one or more Lichess speed groups.
                  </span>
                  <select
                    multiple
                    size="4"
                    aria-label="Popularity time controls"
                    onChange={(event) =>
                      setSources((current) => ({
                        ...current,
                        popularity: {
                          ...current.popularity,
                          speeds: [...event.currentTarget.selectedOptions].map(
                            (option) => option.value as (typeof current.popularity.speeds)[number],
                          ),
                        },
                      }))
                    }
                  >
                    <For each={EXPLORER_SPEEDS}>
                      {(speed) => (
                        <option
                          value={speed}
                          selected={sources().popularity.speeds.includes(speed)}
                        >
                          {speed}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <label>
                  <span>Rating buckets</span>
                  <span class="strategic-fit-field-help">
                    Select one or more online rating populations.
                  </span>
                  <select
                    multiple
                    size="4"
                    aria-label="Popularity rating buckets"
                    onChange={(event) =>
                      setSources((current) => ({
                        ...current,
                        popularity: {
                          ...current.popularity,
                          ratings: [...event.currentTarget.selectedOptions].map(
                            (option) =>
                              Number(option.value) as (typeof current.popularity.ratings)[number],
                          ),
                        },
                      }))
                    }
                  >
                    <For each={EXPLORER_RATING_BUCKETS}>
                      {(rating) => (
                        <option
                          value={rating}
                          selected={sources().popularity.ratings.includes(rating)}
                        >
                          {rating === 0 ? "All ratings" : `${rating}+`}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>
              <label>
                <span>Since</span>
                <input
                  type="text"
                  pattern={
                    sources().popularity.db === "masters" ? "\\d{4}" : "\\d{4}-(0[1-9]|1[0-2])"
                  }
                  placeholder={sources().popularity.db === "masters" ? "YYYY" : "YYYY-MM"}
                  value={sources().popularity.since}
                  onInput={(event) =>
                    setSources((current) => ({
                      ...current,
                      popularity: { ...current.popularity, since: event.currentTarget.value },
                    }))
                  }
                />
              </label>
              <label>
                <span>Until</span>
                <input
                  type="text"
                  pattern={
                    sources().popularity.db === "masters" ? "\\d{4}" : "\\d{4}-(0[1-9]|1[0-2])"
                  }
                  placeholder={sources().popularity.db === "masters" ? "YYYY" : "YYYY-MM"}
                  value={sources().popularity.until}
                  onInput={(event) =>
                    setSources((current) => ({
                      ...current,
                      popularity: { ...current.popularity, until: event.currentTarget.value },
                    }))
                  }
                />
              </label>
            </fieldset>
            <fieldset class="strategic-fit-source-config">
              <legend>Personal history</legend>
              <label class="field-toggle">
                <span>Use personal game history</span>
                <input
                  type="checkbox"
                  checked={sources().personal_history.enabled}
                  onChange={(event) =>
                    setSources((current) => ({
                      ...current,
                      personal_history: {
                        ...current.personal_history,
                        enabled: event.currentTarget.checked,
                      },
                    }))
                  }
                />
              </label>
              <label>
                <span>Platform</span>
                <select
                  value={sources().personal_history.platform}
                  onChange={(event) =>
                    setSources((current) => ({
                      ...current,
                      personal_history: {
                        ...current.personal_history,
                        platform: event.currentTarget.value as "lichess" | "chesscom",
                      },
                    }))
                  }
                >
                  <option value="lichess">Lichess</option>
                  <option value="chesscom">Chess.com</option>
                </select>
              </label>
              <label>
                <span>Username</span>
                <input
                  type="text"
                  maxlength="64"
                  value={sources().personal_history.username}
                  onInput={(event) =>
                    setSources((current) => ({
                      ...current,
                      personal_history: {
                        ...current.personal_history,
                        username: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </label>
              <Show
                when={sources().personal_history.platform === "lichess"}
                fallback={
                  <>
                    <label>
                      <span>Year</span>
                      <input
                        type="number"
                        min="2007"
                        max="2100"
                        value={sources().personal_history.year}
                        onInput={(event) =>
                          setSources((current) => ({
                            ...current,
                            personal_history: {
                              ...current.personal_history,
                              year: Number(event.currentTarget.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Month</span>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={sources().personal_history.month}
                        onInput={(event) =>
                          setSources((current) => ({
                            ...current,
                            personal_history: {
                              ...current.personal_history,
                              month: Number(event.currentTarget.value),
                            },
                          }))
                        }
                      />
                    </label>
                  </>
                }
              >
                <label>
                  <span>Maximum games (1–100)</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={sources().personal_history.max_games}
                    onInput={(event) =>
                      setSources((current) => ({
                        ...current,
                        personal_history: {
                          ...current.personal_history,
                          max_games: Number(event.currentTarget.value),
                        },
                      }))
                    }
                  />
                </label>
              </Show>
            </fieldset>
          </details>

          <aside class="strategic-fit-impact-preview" aria-labelledby="strategic-fit-impact-title">
            <strong id="strategic-fit-impact-title">Affected metrics preview</strong>
            <ul>
              <For each={impact()}>{(item) => <li>{item}</li>}</For>
            </ul>
          </aside>
          <div class="strategic-fit-settings-actions">
            <button type="button" onClick={resetDraft}>
              Reset unsaved changes
            </button>
            <button type="button" class="primary" disabled={!changed()} onClick={save}>
              Save custom settings
            </button>
          </div>
        </div>
      </Show>
      <p class="strategic-fit-settings-announcement" aria-live="polite">
        {announcement()}
      </p>
    </section>
  );
}
