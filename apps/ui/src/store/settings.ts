import { createSignal } from "solid-js";
import { setExplorerToken } from "@chess-mcp/chess-tools";
import type { ChatMode } from "../llm/workflows";

const KEY_API = "chess.openrouter.key";
const KEY_MODEL = "chess.openrouter.model";
const KEY_MODE = "chess.chat.mode";
const KEY_LICHESS = "chess.lichess.token";
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

/**
 * Every chat round resends the whole browser tool schema plus the workflow guidance (about 16–18k
 * tokens, measured 2026-10-11) and a turn runs up to 12 rounds, so a model needs tool calling with
 * `tool_choice`, streaming, a context window of at least 128k, and ideally prompt caching. Prices
 * are USD per million input/output tokens at the cheapest listed provider on 2026-10-11, read from
 * each model's /endpoints route, because the /models route shows a different provider per model.
 * Providers differ by price, and the cheapest are often fp4-quantized. Every entry has a 1M window.
 * Each stands for one trade-off, per Artificial Analysis (Intelligence Index v4.3.2, 2026-10-11):
 * DeepSeek V4.1 Flash balances speed and capability (39 at 217 tokens/s), GLM 5.3 Flash is the
 * capability pick (42), and MiMo V2.6 Flash is the cheapest (38 for $0.06 per index task).
 */
export const MODEL_SUGGESTIONS: { label: string; slug: string; price: string }[] = [
  { label: "DeepSeek V4.1 Flash", slug: "deepseek/deepseek-v4.1-flash", price: "$0.04 / $0.14" },
  { label: "GLM 5.3 Flash", slug: "z-ai/glm-5.3-flash", price: "$0.04 / $0.50" },
  { label: "MiMo V2.6 Flash", slug: "xiaomi/mimo-v2.6-flash", price: "$0.10 / $0.28" },
];

function read(k: string, fallback: string): string {
  try {
    return globalThis.localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
}

const [apiKey, setApiKeyRaw] = createSignal(read(KEY_API, ""));
const [model, setModelRaw] = createSignal(read(KEY_MODEL, DEFAULT_MODEL));

export { apiKey, model };

export function setApiKey(v: string) {
  setApiKeyRaw(v);
  if (v) localStorage.setItem(KEY_API, v);
  else localStorage.removeItem(KEY_API);
}

export function setModel(v: string) {
  const m = v.trim() || DEFAULT_MODEL;
  setModelRaw(m);
  localStorage.setItem(KEY_MODEL, m);
}

const initialLichessToken = read(KEY_LICHESS, "");
const [lichessToken, setLichessTokenRaw] = createSignal(initialLichessToken);
setExplorerToken(initialLichessToken || null);

export { lichessToken };

export function setLichessToken(v: string) {
  const t = v.trim();
  setLichessTokenRaw(t);
  if (t) localStorage.setItem(KEY_LICHESS, t);
  else localStorage.removeItem(KEY_LICHESS);
  setExplorerToken(t || null);
}

const KEY_CLOUD = "chess.cloudeval.enabled";
const [cloudEvalEnabled, setCloudEvalEnabledRaw] = createSignal(read(KEY_CLOUD, "true") === "true");
export { cloudEvalEnabled };
export function setCloudEvalEnabled(v: boolean) {
  setCloudEvalEnabledRaw(v);
  localStorage.setItem(KEY_CLOUD, String(v));
}

const savedMode = read(KEY_MODE, "") as ChatMode;
const [chatMode, setChatModeRaw] = createSignal<ChatMode>(
  ["", "general", "repertoire", "review", "position", "annotate"].includes(savedMode)
    ? savedMode
    : "",
);
export { chatMode };
export function setChatMode(m: ChatMode) {
  setChatModeRaw(m);
  localStorage.setItem(KEY_MODE, m);
}

export const hasApiKey = () => apiKey().length > 0;

const KEY_TECHNICAL = "chess.chat.technical";
const [showTechnicalDetails, setShowTechnicalDetailsRaw] = createSignal(
  read(KEY_TECHNICAL, "false") === "true",
);
export { showTechnicalDetails };
export function setShowTechnicalDetails(v: boolean) {
  setShowTechnicalDetailsRaw(v);
  localStorage.setItem(KEY_TECHNICAL, String(v));
}

export type SettingsFocusTarget = "lichess-token" | "api-key" | "engine" | null;
const [settingsFocusTarget, setSettingsFocusTargetRaw] = createSignal<SettingsFocusTarget>(null);
export { settingsFocusTarget };
export function setSettingsFocusTarget(target: SettingsFocusTarget) {
  setSettingsFocusTargetRaw(target);
}
