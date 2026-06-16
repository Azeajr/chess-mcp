/**
 * User settings persisted to localStorage: the OpenRouter API key and model slug. The key is
 * stored in plaintext and is readable by any injected script (XSS) — see UI_DESIGN.md "Browser
 * Constraints & Security". Keep the bundle dependency-minimal.
 */
import { createSignal } from "solid-js";

const KEY_API = "chess.openrouter.key";
const KEY_MODEL = "chess.openrouter.model";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

/** Example OpenRouter slugs offered as clickable chips in Settings. */
export const MODEL_SUGGESTIONS = [
  "deepseek/deepseek-v4-flash",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.1",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  "meta-llama/llama-4-maverick",
  "x-ai/grok-4",
  "qwen/qwen3-max",
];

const read = (k: string, fallback: string) => localStorage.getItem(k) ?? fallback;

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

export const hasApiKey = () => apiKey().length > 0;
