/**
 * User settings persisted to localStorage: the OpenRouter API key, model slug, and Lichess
 * token. The keys are stored in plaintext and are readable by any injected script (XSS) — see
 * UI_DESIGN.md "Browser Constraints & Security". Keep the bundle dependency-minimal.
 */
import { createSignal } from "solid-js";
import { setExplorerToken } from "@chess-mcp/chess-tools";
import type { ChatMode } from "../llm/workflows";

const KEY_API = "chess.openrouter.key";
const KEY_MODEL = "chess.openrouter.model";
const KEY_MODE = "chess.chat.mode";
const KEY_LICHESS = "chess.lichess.token";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

/** The selectable models (friendly label → OpenRouter slug), shown as chips in Settings. */
export const MODEL_SUGGESTIONS: { label: string; slug: string }[] = [
  { label: "DeepSeek V4 Flash", slug: "deepseek/deepseek-v4-flash" },
  { label: "DeepSeek V4 Pro", slug: "deepseek/deepseek-v4-pro" },
  { label: "DeepSeek-R1 (Distill 32B)", slug: "deepseek/deepseek-r1-distill-qwen-32b" },
  { label: "Sonnet 4.6", slug: "anthropic/claude-sonnet-4.6" },
  { label: "Llama 4 Scout 17B", slug: "meta-llama/llama-4-scout" },
  { label: "Qwen3-32B", slug: "qwen/qwen3-32b" },
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

// Lichess personal API token (no scopes) — required by the opening explorer since ~2026-03.
// Mirrors the OpenRouter key handling; also feeds the shared chess-tools token holder so the
// explorer client sends Authorization on every lookup.
const [lichessToken, setLichessTokenRaw] = createSignal(read(KEY_LICHESS, ""));
setExplorerToken(lichessToken() || null);

export { lichessToken };

export function setLichessToken(v: string) {
  const t = v.trim();
  setLichessTokenRaw(t);
  if (t) localStorage.setItem(KEY_LICHESS, t);
  else localStorage.removeItem(KEY_LICHESS);
  setExplorerToken(t || null);
}

const [chatMode, setChatModeRaw] = createSignal<ChatMode>(read(KEY_MODE, "") as ChatMode);
export { chatMode };
export function setChatMode(m: ChatMode) {
  setChatModeRaw(m);
  localStorage.setItem(KEY_MODE, m);
}

export const hasApiKey = () => apiKey().length > 0;
