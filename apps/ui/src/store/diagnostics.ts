import { createSignal } from "solid-js";
import type { ChatMessage, RoundResult, ToolSchema } from "../llm/openrouter";
import { idbGet, idbSet } from "./idb";
import { assertTestOnly } from "./test-seam";

/**
 * A local, always-on record of what happened in this session and the one before it: every model
 * request exactly as sent, every response, every tool result before compaction, faults and app
 * events. Nothing leaves the browser; the Settings diagnostic bundle is the only way out.
 *
 * Message text is stored once, by content: each round resends the whole conversation and a
 * system prompt that is mostly unchanged, so rounds hold paragraph IDs into a shared text table.
 */

export const DIAGNOSTICS_SCHEMA_VERSION = 1;
const STORAGE_KEY = "diagnostics";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const MAX_FAULTS = 500;
const MAX_EVENTS = 2_000;
const MAX_FAULT_CHARS = 4_000;
const SAVE_DELAY_MS = 1_000;

/** Paragraph IDs; the text is the referenced paragraphs joined by a blank line. */
export type TextRef = readonly string[];

export interface RecordedMessage {
  readonly role: ChatMessage["role"];
  readonly content: TextRef | null;
  readonly tool_calls?: ChatMessage["tool_calls"];
  readonly tool_call_id?: string;
}

export interface RecordedRound {
  readonly at: number;
  readonly turn: number | null;
  readonly round: number;
  readonly ms: number;
  readonly model: string;
  readonly mode: string;
  readonly messages: readonly RecordedMessage[];
  readonly tools: { readonly count: number; readonly schemas: TextRef };
  readonly text?: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
  }[];
  readonly finish?: string;
  readonly usage?: Record<string, unknown>;
  readonly generationId?: string;
  readonly error?: string;
}

export interface RecordedTool {
  readonly at: number;
  readonly turn: number | null;
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly status: string;
  readonly ms: number;
  readonly result: TextRef;
  readonly characters: number;
}

export interface RecordedFault {
  readonly at: number;
  readonly kind: "console.error" | "console.warn" | "error" | "unhandledrejection" | "diagnostics";
  readonly message: string;
}

export interface RecordedEvent {
  readonly at: number;
  readonly kind: string;
  readonly detail: Record<string, unknown>;
}

export interface DiagnosticSession {
  readonly id: string;
  readonly startedAt: number;
  rounds: RecordedRound[];
  tools: RecordedTool[];
  faults: RecordedFault[];
  events: RecordedEvent[];
  /** Entries dropped to stay inside the storage budget. */
  evicted: number;
}

interface PersistedDiagnostics {
  readonly schemaVersion: number;
  readonly sessions: readonly DiagnosticSession[];
  readonly texts: readonly (readonly [string, string])[];
}

export interface DiagnosticsStorage {
  load(): Promise<unknown>;
  save(value: PersistedDiagnostics): Promise<void>;
}

const idbStorage: DiagnosticsStorage = {
  load: () => idbGet(STORAGE_KEY),
  save: (value) => idbSet(STORAGE_KEY, value),
};

function newSession(): DiagnosticSession {
  return {
    id: `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    rounds: [],
    tools: [],
    faults: [],
    events: [],
    evicted: 0,
  };
}

let storage = idbStorage;
let current = newSession();
let previous: DiagnosticSession | null = null;
let texts = new Map<string, string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastTurn: number | null = null;
let roundInTurn = 0;
const [revision, setRevision] = createSignal(0);

// cyrb53: a fast, well-distributed 53-bit string hash. Content addressing only, not security.
function hash(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `t${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** Stores text by paragraph in `table` and returns the paragraph IDs. */
export function internText(text: string, table: Map<string, string> = texts): TextRef {
  const kept =
    text.length > MAX_TEXT_CHARS
      ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[diagnostics: truncated ${text.length - MAX_TEXT_CHARS} characters]`
      : text;
  return kept.split("\n\n").map((paragraph) => {
    const id = hash(paragraph);
    if (!table.has(id)) table.set(id, paragraph);
    return id;
  });
}

export function resolveText(ref: TextRef, table: ReadonlyMap<string, string> = texts): string {
  return ref.map((id) => table.get(id) ?? `[diagnostics: missing ${id}]`).join("\n\n");
}

function changed() {
  setRevision((value) => value + 1);
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushDiagnostics();
  }, SAVE_DELAY_MS);
}

function bounded<T>(list: T[], limit: number): T[] {
  return list.length > limit ? list.slice(list.length - limit) : list;
}

function recordModelRoundUnguarded(input: {
  readonly turn: number | null;
  readonly model: string;
  readonly mode: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSchema[];
  readonly startedAt: number;
  readonly result?: RoundResult;
  readonly error?: string;
}) {
  if (input.turn !== lastTurn) {
    lastTurn = input.turn;
    roundInTurn = 0;
  }
  roundInTurn += 1;
  const { result } = input;
  current.rounds.push({
    at: input.startedAt,
    turn: input.turn,
    round: roundInTurn,
    ms: Date.now() - input.startedAt,
    model: input.model,
    mode: input.mode,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content === null ? null : internText(message.content),
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    })),
    tools: { count: input.tools.length, schemas: internText(JSON.stringify(input.tools)) },
    ...(result
      ? {
          text: result.content,
          toolCalls: result.toolCalls.map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          })),
          ...(result.abnormalFinish ? { finish: result.abnormalFinish } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.generationId ? { generationId: result.generationId } : {}),
        }
      : {}),
    ...(input.error === undefined ? {} : { error: input.error }),
  });
  changed();
}

function recordToolCallUnguarded(input: {
  readonly turn: number | null;
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly status: string;
  readonly startedAt: number;
  readonly result: string;
}) {
  current.tools.push({
    at: input.startedAt,
    turn: input.turn,
    id: input.id,
    name: input.name,
    arguments: input.arguments,
    status: input.status,
    ms: Date.now() - input.startedAt,
    result: internText(input.result),
    characters: input.result.length,
  });
  changed();
}

function recordEventUnguarded(kind: string, detail: Record<string, unknown> = {}) {
  current.events = bounded([...current.events, { at: Date.now(), kind, detail }], MAX_EVENTS);
  changed();
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    // `undefined` and functions have no JSON form.
    const json = JSON.stringify(value) as string | undefined;
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function recordFaultUnguarded(kind: RecordedFault["kind"], values: readonly unknown[]) {
  const message = values.map(describe).join(" ").slice(0, MAX_FAULT_CHARS);
  current.faults = bounded([...current.faults, { at: Date.now(), kind, message }], MAX_FAULTS);
  changed();
}

/**
 * The record must never break the app it observes: a value it cannot store becomes a fault
 * entry instead of an exception in the chat loop or an operation.
 */
function guarded<Args extends unknown[]>(record: (...args: Args) => void) {
  return (...args: Args) => {
    try {
      record(...args);
    } catch (error) {
      try {
        recordFaultUnguarded("diagnostics", [`could not record ${record.name}:`, error]);
      } catch {
        // Nothing further can be recorded.
      }
    }
  };
}

export const recordModelRound = guarded(recordModelRoundUnguarded);
export const recordToolCall = guarded(recordToolCallUnguarded);
export const recordEvent = guarded(recordEventUnguarded);
export const recordFault = guarded(recordFaultUnguarded);

let captureInstalled = false;

/** Mirrors console errors and warnings, uncaught errors and rejections into the record. */
export function installFaultCapture(target: Window & typeof globalThis = window) {
  if (captureInstalled) return;
  captureInstalled = true;
  for (const level of ["error", "warn"] as const) {
    const original = target.console[level].bind(target.console);
    target.console[level] = (...values: unknown[]) => {
      recordFault(`console.${level}`, values);
      original(...values);
    };
  }
  target.addEventListener("error", (event) => {
    recordFault("error", [event.error ?? event.message]);
  });
  target.addEventListener("unhandledrejection", (event) => {
    recordFault("unhandledrejection", [event.reason]);
  });
  target.addEventListener("visibilitychange", () => {
    if (target.document.visibilityState === "hidden") void flushDiagnostics();
  });
}

function referencedTexts(sessions: readonly DiagnosticSession[]): Set<string> {
  const used = new Set<string>();
  const add = (ref: TextRef | null) => ref?.forEach((id) => used.add(id));
  for (const session of sessions) {
    for (const round of session.rounds) {
      round.messages.forEach((message) => {
        add(message.content);
      });
      add(round.tools.schemas);
    }
    session.tools.forEach((tool) => {
      add(tool.result);
    });
  }
  return used;
}

function collectTexts() {
  const used = referencedTexts(sessions());
  for (const id of texts.keys()) if (!used.has(id)) texts.delete(id);
}

function storedBytes(): number {
  let total = 0;
  for (const text of texts.values()) total += text.length;
  for (const session of sessions()) total += JSON.stringify(session).length;
  return total;
}

const evictable = (session: DiagnosticSession) =>
  session.rounds.length + session.tools.length + session.events.length;

/**
 * Drops the oldest rounds, tool calls and events, earlier session first, until the record fits.
 * Faults are kept. Each pass drops a twentieth of a session, so a full record settles in a few
 * measurements rather than one per entry.
 */
function enforceBudget(limit: number) {
  collectTexts();
  while (storedBytes() > limit) {
    const session = previous && evictable(previous) > 0 ? previous : current;
    let remaining = Math.max(1, Math.ceil(evictable(session) / 20));
    while (remaining > 0 && evictable(session) > 0) {
      const [oldest] = [session.rounds, session.tools, session.events]
        .filter((list) => list.length > 0)
        .sort((left, right) => (left[0]?.at ?? 0) - (right[0]?.at ?? 0));
      oldest?.shift();
      session.evicted += 1;
      remaining -= 1;
    }
    if (evictable(session) === 0 && session === current) break;
    collectTexts();
  }
  collectTexts();
}

export const sessions = (): DiagnosticSession[] => (previous ? [previous, current] : [current]);

export function diagnosticTexts(): ReadonlyMap<string, string> {
  return texts;
}

export function diagnosticStats() {
  revision();
  return {
    rounds: current.rounds.length,
    tools: current.tools.length,
    faults: current.faults.length,
    previousRounds: previous?.rounds.length ?? 0,
    bytes: storedBytes(),
  };
}

export async function flushDiagnostics(limit = MAX_BYTES) {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  enforceBudget(limit);
  try {
    await storage.save({
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      sessions: sessions(),
      texts: [...texts],
    });
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory record still works.
  }
}

// Every page load records its restored document, settings and profile, so those events alone say
// nothing happened: a reload, such as an update's, must not displace the session the user wants.
const STARTUP_EVENTS = new Set(["document", "settings", "strategic-fit-profile"]);

const isActivity = (event: RecordedEvent) =>
  !STARTUP_EVENTS.has(event.kind) &&
  !(event.kind === "strategic-fit" && event.detail.status === "idle");

const hasContent = (session: DiagnosticSession) =>
  session.rounds.length + session.tools.length + session.faults.length > 0 ||
  session.events.some(isActivity);

function isPersisted(value: unknown): value is PersistedDiagnostics {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PersistedDiagnostics).schemaVersion === DIAGNOSTICS_SCHEMA_VERSION &&
    Array.isArray((value as PersistedDiagnostics).sessions) &&
    Array.isArray((value as PersistedDiagnostics).texts)
  );
}

/** Loads the record the last page left behind and keeps its latest session as the previous one. */
export async function restoreDiagnostics() {
  let value: unknown;
  try {
    value = await storage.load();
  } catch {
    return;
  }
  if (!isPersisted(value)) return;
  const restored = [...value.sessions].reverse().find(hasContent);
  if (!restored) return;
  previous = restored;
  for (const [id, text] of value.texts) if (!texts.has(id)) texts.set(id, text);
  collectTexts();
  changed();
}

export function clearDiagnostics() {
  current = newSession();
  previous = null;
  texts = new Map();
  lastTurn = null;
  roundInTurn = 0;
  changed();
  void flushDiagnostics();
}

export function setDiagnosticsStorageForTesting(next?: DiagnosticsStorage) {
  assertTestOnly();
  storage = next ?? idbStorage;
}

export function resetDiagnosticsForTesting() {
  assertTestOnly();
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  current = newSession();
  previous = null;
  texts = new Map();
  lastTurn = null;
  roundInTurn = 0;
}

export function enforceDiagnosticsBudgetForTesting(limit: number) {
  assertTestOnly();
  enforceBudget(limit);
}
