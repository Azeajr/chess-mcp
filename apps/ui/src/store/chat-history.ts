import { createSignal } from "solid-js";
import type { ChatMessage } from "../llm/openrouter";

// The conversation transcript, kept apart from the chat turn executor so browser commands can read
// it without importing the executor and, through it, every UI adapter.
export const [history, setHistory] = createSignal<ChatMessage[]>([]);
