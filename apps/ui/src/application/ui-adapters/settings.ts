import { analysisDepth, setAnalysisDepth } from "../../store/engine-settings";
import {
  chatMode,
  cloudEvalEnabled,
  hasApiKey,
  lichessToken,
  setChatMode,
  setCloudEvalEnabled,
  setSettingsFocusTarget,
  setShowTechnicalDetails,
  showTechnicalDetails,
  type SettingsFocusTarget,
} from "../../store/settings";
import { setSettingsOpen } from "../../store/ui";
import { CHAT_MODES } from "../../llm/workflows";
import type { AssistantTurnContext } from "./proposals";

export { SETTINGS_SECTIONS, PUBLIC_SETTINGS } from "./catalog";
import type { PublicSetting, SettingsSection } from "./catalog";

/** Public values and readiness booleans only. Credentials never enter assistant context. */
export function settingsSnapshot() {
  return {
    analysis_depth: analysisDepth(),
    cloud_eval: cloudEvalEnabled(),
    technical_details: showTechnicalDetails(),
    chat_workflow: chatMode(),
    openrouter_key_configured: hasApiKey(),
    lichess_token_configured: lichessToken().length > 0,
  };
}

export function openSettings(section: SettingsSection) {
  const target: SettingsFocusTarget = section === "general" ? null : section;
  setSettingsFocusTarget(target);
  setSettingsOpen(true);
}

// A setting changes only when the user's own current message asked for it; anything the assistant
// merely infers stays a suggestion in conversation. The wording check is a floor, not a parser.
const REQUESTED: Readonly<Record<PublicSetting, RegExp>> = {
  analysis_depth: /\bdepth\b/i,
  cloud_eval: /\bcloud\b/i,
  technical_details: /\b(technical|raw|json|error codes?)\b/i,
  chat_workflow: /\b(workflow|mode|preset)\b/i,
};

type SettingResult =
  | { ok: true; setting: PublicSetting; value: unknown }
  | { ok: false; error: string; reason: string };

export function applyRequestedSetting(
  input: { setting: PublicSetting; value: unknown; requestMessageId: string },
  turn: AssistantTurnContext | undefined,
): SettingResult {
  if (turn?.messageId !== input.requestMessageId)
    return {
      ok: false,
      error: "request_message_invalid",
      reason: "A setting change must cite the user's current message.",
    };
  if (!REQUESTED[input.setting].test(turn.text))
    return {
      ok: false,
      error: "setting_not_requested",
      reason: "The user did not ask for this setting. Suggest it instead and let them choose.",
    };
  switch (input.setting) {
    case "analysis_depth": {
      if (typeof input.value !== "number" || !Number.isInteger(input.value))
        return { ok: false, error: "invalid_value", reason: "Depth is a whole number 1–30." };
      setAnalysisDepth(input.value);
      return { ok: true, setting: input.setting, value: analysisDepth() };
    }
    case "cloud_eval":
    case "technical_details": {
      if (typeof input.value !== "boolean")
        return { ok: false, error: "invalid_value", reason: "Use true or false." };
      if (input.setting === "cloud_eval") setCloudEvalEnabled(input.value);
      else setShowTechnicalDetails(input.value);
      return {
        ok: true,
        setting: input.setting,
        value: input.setting === "cloud_eval" ? cloudEvalEnabled() : showTechnicalDetails(),
      };
    }
    case "chat_workflow": {
      const mode = CHAT_MODES.find((entry) => entry.id === input.value);
      if (!mode)
        return {
          ok: false,
          error: "invalid_value",
          reason: `Use one of ${CHAT_MODES.map((entry) => entry.id).join(", ")}.`,
        };
      setChatMode(mode.id);
      return { ok: true, setting: input.setting, value: chatMode() };
    }
  }
}
