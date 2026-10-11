import { createEffect, createMemo, createRoot, on } from "solid-js";
import {
  projectStrategicFitConversation,
  serializeStrategicFitSidecar,
  STRATEGIC_FIT_CONVERSATION_LIMITS,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";
import {
  DIAGNOSTICS_SCHEMA_VERSION,
  diagnosticTexts,
  internText,
  recordEvent,
  resolveText,
  sessions,
  type DiagnosticSession,
} from "../store/diagnostics";
import { history } from "../store/chat-history";
import { chatContextSnapshot, toolRuns } from "../store/chat";
import {
  apiKey,
  chatMode,
  cloudEvalEnabled,
  lichessToken,
  model,
  showTechnicalDetails,
} from "../store/settings";
import { analysisDepth } from "../store/engine-settings";
import { color, documentId, fileName, toPgn, version } from "../store/game";
import { operations } from "../store/operations";
import { strategicFitLifecycle } from "../store/strategic-fit";
import { strategicFitProfile } from "../store/strategic-fit-profile";
import { strategicFitMetadata, strategicFitMetadataStatus } from "../store/strategic-fit-metadata";
import { getCachedStrategicFitReportById } from "./strategic-fit-report-cache";
import { uiSnapshot } from "./ui-actions";
import { pendingProposals } from "./ui-adapters/proposals";

const README =
  "Chess Repertoire diagnostic bundle. Message contents, tool results and tool schemas are lists of " +
  "paragraph IDs: look each one up in `texts` and join them with a blank line. `sessions` holds the " +
  "previous page session (if any) and this one; `timeline` is the same record as one line per entry.";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attempt<T>(read: () => T): T | { error: string } {
  try {
    return read();
  } catch (error) {
    return { error: message(error) };
  }
}

function app() {
  const env = Reflect.get(import.meta, "env") as { MODE?: string } | undefined;
  return {
    build: typeof __APP_BUILD__ === "undefined" ? null : __APP_BUILD__,
    mode: env?.MODE ?? null,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    online: navigator.onLine,
    crossOriginIsolated: window.crossOriginIsolated,
    // Insecure origins have no service worker container at all.
    serviceWorker:
      "serviceWorker" in navigator && navigator.serviceWorker.controller ? "controlled" : "none",
  };
}

function strategicFitFindings(report: StrategicFitReport) {
  const base = {
    report_id: report.report_id,
    expected_repertoire_revision: report.repertoire_revision,
  };
  const summary = projectStrategicFitConversation(report, { ...base, view: "summary" });
  const findings: unknown[] = [];
  for (let offset = 0; ;) {
    const page = projectStrategicFitConversation(report, {
      ...base,
      view: "findings",
      page: { offset, limit: STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum },
    });
    if (page.retrieval !== "strategic-fit-findings") break;
    findings.push(...page.findings);
    offset += page.page.returned_count;
    if (!page.page.has_more || page.page.returned_count === 0) break;
  }
  return { summary, findings };
}

function strategicFit(includeRepertoire: boolean) {
  const lifecycle = strategicFitLifecycle();
  const completed = lifecycle.current_result;
  const report = completed ? getCachedStrategicFitReportById(completed.report_id) : undefined;
  const snapshot = completed?.request_snapshot;
  return {
    lifecycle: {
      status: lifecycle.status,
      error: lifecycle.error,
      stale_reason: lifecycle.stale_reason,
      progress: lifecycle.progress,
      report_id: completed?.report_id ?? null,
      completed_at: completed?.completed_at ?? null,
      request: snapshot
        ? {
            document_id: snapshot.document_id,
            repertoire_revision: snapshot.repertoire_revision,
            repertoire_color: snapshot.repertoire_color,
            profile_identity: snapshot.profile_identity,
            settings_identity: snapshot.settings_identity,
            ...(includeRepertoire ? { repertoire_pgn: snapshot.repertoire_pgn } : {}),
          }
        : null,
    },
    profile: strategicFitProfile(),
    metadataStatus: strategicFitMetadataStatus(),
    metadata: attempt(
      () =>
        JSON.parse(serializeStrategicFitSidecar(documentId(), strategicFitMetadata())) as unknown,
    ),
    // The full report runs to megabytes; the PGN, profile and metadata above reproduce it, and these
    // are the bounded views the assistant reads.
    report: report
      ? {
          analysis_version: report.analysis_version,
          ...attempt(() => strategicFitFindings(report)),
        }
      : null,
  };
}

interface TimelineEntry {
  readonly at: number;
  readonly line: string;
}

const clip = (text: string, limit = 160) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

function timeline(list: readonly DiagnosticSession[]): string[] {
  const entries: TimelineEntry[] = [];
  for (const session of list) {
    entries.push({ at: session.startedAt, line: `session ${session.id} started` });
    for (const round of session.rounds) {
      const where = `turn ${round.turn ?? "-"} round ${round.round}`;
      const outcome = round.error
        ? `failed: ${clip(round.error)}`
        : round.toolCalls?.length
          ? `calls ${round.toolCalls.map((call) => call.name).join(", ")}`
          : `replies: ${clip(round.text ?? "")}`;
      entries.push({
        at: round.at,
        line: `model ${where} (${round.model}, ${round.ms} ms, ${round.messages.length} messages): ${outcome}`,
      });
    }
    for (const tool of session.tools)
      entries.push({
        at: tool.at,
        line: `tool ${tool.name} → ${tool.status} (${tool.ms} ms, ${tool.characters} chars)`,
      });
    for (const fault of session.faults)
      entries.push({ at: fault.at, line: `${fault.kind}: ${clip(fault.message, 300)}` });
    for (const event of session.events)
      entries.push({
        at: event.at,
        line:
          event.kind === "user-message"
            ? `user (turn ${String(event.detail.turn)}): ${clip(String(event.detail.text))}`
            : `${event.kind}: ${clip(JSON.stringify(event.detail), 240)}`,
      });
  }
  return entries
    .sort((left, right) => left.at - right.at)
    .map((entry) => `${new Date(entry.at).toISOString()} ${entry.line}`);
}

const SECRET_PATTERNS = [/sk-or-[A-Za-z0-9_-]{8,}/g, /lip_[A-Za-z0-9]{8,}/g];

/** Removes stored credentials, and anything shaped like one, from the serialized bundle. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets)
    if (secret.length >= 8) redacted = redacted.split(secret).join("[redacted]");
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[redacted]");
  return redacted;
}

const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(/\.\d+Z$/, "");

export function buildDiagnosticBundle(options: { readonly includeRepertoire: boolean }) {
  const savedAt = new Date();
  const recorded = sessions();
  // The visible conversation shares the recorder's text table, so a result already recorded as a
  // tool call costs nothing more here.
  const texts = new Map(diagnosticTexts());
  const conversation = history().map((entry) => ({
    role: entry.role,
    content: entry.content === null ? null : internText(entry.content, texts),
    ...(entry.tool_calls ? { tool_calls: entry.tool_calls } : {}),
    ...(entry.tool_call_id ? { tool_call_id: entry.tool_call_id } : {}),
  }));
  const bundle = {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    readme: README,
    savedAt: savedAt.toISOString(),
    app: attempt(app),
    settings: {
      model: model(),
      chatMode: chatMode(),
      analysisDepth: analysisDepth(),
      cloudEval: cloudEvalEnabled(),
      technicalDetails: showTechnicalDetails(),
      apiKeySet: apiKey().length > 0,
      lichessTokenSet: lichessToken().length > 0,
    },
    document: {
      id: documentId(),
      fileName: fileName(),
      color: color(),
      revision: version(),
      ...attempt(() => chatContextSnapshot()),
      ...(options.includeRepertoire
        ? { pgn: attempt(() => toPgn()) }
        : { pgn: null, pgnOmitted: true }),
    },
    state: {
      ui: attempt(() => uiSnapshot()),
      proposals: attempt(() => pendingProposals()),
      toolRuns: toolRuns(),
      operations: operations().map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        label: operation.label,
        surface: operation.surface,
        status: operation.status,
        done: operation.done,
        total: operation.total,
        detail: operation.detail,
        startedAt: operation.startedAt,
      })),
      conversation,
    },
    strategicFit: attempt(() => strategicFit(options.includeRepertoire)),
    timeline: timeline(recorded),
    sessions: recorded,
    texts: Object.fromEntries(texts),
  };
  return {
    name: `chess-debug-${stamp(savedAt)}.json`,
    content: redactSecrets(JSON.stringify(bundle, null, 1), [apiKey(), lichessToken()]),
  };
}

/** Text of one recorded paragraph list, for tests and tooling that read a bundle back. */
export function bundleText(ref: readonly string[], texts: Readonly<Record<string, string>>) {
  return resolveText(ref, new Map(Object.entries(texts)));
}

let observing = false;

/** Records document, Strategic Fit and settings changes as they happen. */
export function observeAppForDiagnostics() {
  if (observing) return;
  observing = true;
  createRoot(() => {
    createEffect(
      on([documentId, fileName, color], ([id, name, side]) => {
        recordEvent("document", { id, fileName: name, color: side, revision: version() });
      }),
    );
    createEffect(
      on(
        version,
        (revision) => {
          recordEvent("revision", { revision });
        },
        { defer: true },
      ),
    );
    let lastLifecycle = "";
    createEffect(() => {
      const lifecycle = strategicFitLifecycle();
      const detail = {
        status: lifecycle.status,
        report_id: lifecycle.current_result?.report_id ?? null,
        error: lifecycle.error?.code ?? null,
        stale_reason: lifecycle.stale_reason,
      };
      const key = JSON.stringify(detail);
      if (key === lastLifecycle) return;
      lastLifecycle = key;
      recordEvent("strategic-fit", detail);
    });
    // The profile object is replaced more often than its mode changes; record the mode once.
    const profileMode = createMemo(() => strategicFitProfile().mode);
    createEffect(
      on(profileMode, (mode) => {
        recordEvent("strategic-fit-profile", { mode });
      }),
    );
    createEffect(
      on([model, chatMode, analysisDepth, cloudEvalEnabled, showTechnicalDetails], (values) => {
        const [modelSlug, mode, depth, cloud, technical] = values;
        recordEvent("settings", { model: modelSlug, chatMode: mode, depth, cloud, technical });
      }),
    );
  });
}
