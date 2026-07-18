import { createSignal } from "solid-js";
import {
  STRATEGIC_FIT_MAX_PAGE_SIZE,
  sortStrategicFitFindings,
  type FindingPriorityKind,
  type FindingPriorityLabel,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitFindingPage,
  type StrategicFitFindingSort,
} from "@chess-mcp/chess-tools";
import type { BrowserCommandExecutionOptions } from "../application/browser-commands/types";
import { executeDirectBrowserCommand } from "./commands";
import {
  strategicFitFindingQueueFilterKey,
  type StrategicFitFindingQueueFilter,
  type StrategicFitFindingQueueIntent,
} from "./ui";

export const STRATEGIC_FIT_QUEUE_PAGE_SIZE = 6;

export type StrategicFitQueueStatus = "empty" | "loading" | "ready" | "error";
export type StrategicFitQueuePriorityFilter = FindingPriorityLabel | "all";

export interface StrategicFitFindingQueueSnapshot {
  readonly report_id: string | null;
  readonly repertoire_revision: string | null;
  readonly status: StrategicFitQueueStatus;
  readonly findings: readonly StrategicFinding[];
  readonly canonical_total_count: number;
  readonly error: string | null;
  readonly sort: StrategicFitFindingSort;
  readonly priority_kind: FindingPriorityKind;
  readonly priority_filter: StrategicFitQueuePriorityFilter;
  readonly opening_filter: string;
  readonly intent: StrategicFitFindingQueueIntent | null;
  readonly page_offset: number;
  readonly selected_finding_id: string | null;
}

export interface StrategicFitFindingQueueView {
  readonly findings: readonly StrategicFinding[];
  readonly filtered_findings: readonly StrategicFinding[];
  readonly opening_options: readonly string[];
  readonly page: StrategicFitFindingPage;
  readonly canonical_total_count: number;
  readonly selected_finding_id: string | null;
}

export interface StrategicFitFindingQueueBoundary {
  execute(
    command: "analyze_repertoire_congruence",
    args: Record<string, unknown>,
    options: BrowserCommandExecutionOptions,
  ): Promise<unknown>;
}

export interface StrategicFitFindingQueueState {
  snapshot(): StrategicFitFindingQueueSnapshot;
  view(): StrategicFitFindingQueueView;
  synchronize(
    report: StrategicFitAnalysisResult | null,
    intent?: StrategicFitFindingQueueIntent | null,
  ): Promise<void>;
  setSort(sort: StrategicFitFindingSort): void;
  setPriorityKind(kind: FindingPriorityKind): void;
  setPriorityFilter(filter: StrategicFitQueuePriorityFilter): void;
  setOpeningFilter(opening: string): void;
  setPageOffset(offset: number): void;
  selectFinding(findingId: string | null): void;
  dispose(): void;
}

const initialSnapshot = (): StrategicFitFindingQueueSnapshot => ({
  report_id: null,
  repertoire_revision: null,
  status: "empty",
  findings: [],
  canonical_total_count: 0,
  error: null,
  sort: "replacement-priority",
  priority_kind: "replacement",
  priority_filter: "all",
  opening_filter: "",
  intent: null,
  page_offset: 0,
  selected_finding_id: null,
});

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function matchesIntent(finding: StrategicFinding, filter: StrategicFitFindingQueueFilter): boolean {
  if (filter.kind === "classification") return finding.classification === filter.classification;
  if (filter.kind === "resolution") return finding.resolution_state === filter.resolution;
  if (filter.kind === "evidence") {
    return finding.classification === "uncertain" ||
      finding.classification === "data-quality-issue" ||
      finding.resolution_state === "insufficient-evidence" ||
      finding.replacement_priority.label === "insufficient-evidence" ||
      finding.training_priority.label === "insufficient-evidence";
  }
  return true;
}

export function buildStrategicFitFindingQueueView(
  state: StrategicFitFindingQueueSnapshot,
): StrategicFitFindingQueueView {
  const intentFilter = state.intent?.filter ?? { kind: "all" as const };
  const filtered = state.findings.filter((finding) =>
    matchesIntent(finding, intentFilter) &&
    (state.priority_filter === "all" ||
      (state.priority_kind === "replacement"
        ? finding.replacement_priority.label
        : finding.training_priority.label) === state.priority_filter) &&
    (state.opening_filter === "" || finding.opening_scope === state.opening_filter)
  );
  const sorted = sortStrategicFitFindings(filtered, state.sort);
  const lastOffset = sorted.length === 0
    ? 0
    : Math.floor((sorted.length - 1) / STRATEGIC_FIT_QUEUE_PAGE_SIZE) *
      STRATEGIC_FIT_QUEUE_PAGE_SIZE;
  const offset = Math.min(Math.max(0, state.page_offset), lastOffset);
  const findings = sorted.slice(offset, offset + STRATEGIC_FIT_QUEUE_PAGE_SIZE);
  return {
    findings,
    filtered_findings: sorted,
    opening_options: [...new Set(state.findings.map((finding) => finding.opening_scope))]
      .sort(compareStrings),
    page: {
      offset,
      limit: STRATEGIC_FIT_QUEUE_PAGE_SIZE,
      total_count: sorted.length,
      returned_count: findings.length,
      has_more: offset + findings.length < sorted.length,
    },
    canonical_total_count: state.canonical_total_count,
    selected_finding_id: findings.some((finding) => finding.finding_id === state.selected_finding_id)
      ? state.selected_finding_id
      : null,
  };
}

function validPage(
  value: unknown,
  expectedReportId: string,
  expectedRevision: string,
  expectedOffset: number,
  expectedTotal: number,
): StrategicFitAnalysisResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("The finding page response was not a report.");
  }
  const candidate = value as Partial<StrategicFitAnalysisResult> & {
    error?: unknown;
    reason?: unknown;
  };
  if (typeof candidate.error === "string") {
    throw new Error(typeof candidate.reason === "string" ? candidate.reason : candidate.error);
  }
  const page = candidate.finding_page;
  if (
    candidate.report_id !== expectedReportId ||
    candidate.repertoire_revision !== expectedRevision ||
    !Array.isArray(candidate.findings) ||
    page === undefined ||
    page.offset !== expectedOffset ||
    page.total_count !== expectedTotal ||
    page.returned_count !== candidate.findings.length ||
    page.limit < 1 ||
    page.limit > STRATEGIC_FIT_MAX_PAGE_SIZE ||
    page.returned_count > page.limit ||
    page.returned_count === 0 && expectedOffset < expectedTotal ||
    page.has_more !== (page.offset + page.returned_count < page.total_count)
  ) {
    throw new Error("The finding page did not match the current immutable report.");
  }
  return candidate as StrategicFitAnalysisResult;
}

function sameIntent(
  left: StrategicFitFindingQueueIntent | null,
  right: StrategicFitFindingQueueIntent | null,
): boolean {
  return left?.report_id === right?.report_id &&
    left?.source === right?.source &&
    left?.label === right?.label &&
    strategicFitFindingQueueFilterKey(left?.filter ?? { kind: "all" }) ===
      strategicFitFindingQueueFilterKey(right?.filter ?? { kind: "all" });
}

function currentIntent(
  reportId: string,
  intent: StrategicFitFindingQueueIntent | null | undefined,
): StrategicFitFindingQueueIntent | null {
  return intent?.report_id === reportId ? intent : null;
}

export function createStrategicFitFindingQueueState(
  boundary: StrategicFitFindingQueueBoundary,
): StrategicFitFindingQueueState {
  const [state, setState] = createSignal<StrategicFitFindingQueueSnapshot>(initialSnapshot());
  let activeController: AbortController | null = null;
  let loadSequence = 0;

  const resetPageAndSelection = (patch: Partial<StrategicFitFindingQueueSnapshot>) => {
    setState((previous) => ({
      ...previous,
      ...patch,
      page_offset: 0,
      selected_finding_id: null,
    }));
  };

  const loadCompleteReport = async (
    report: StrategicFitAnalysisResult,
    sequence: number,
    controller: AbortController,
  ) => {
    const all: StrategicFinding[] = [];
    const seenIds = new Set<string>();
    let offset = 0;
    try {
      while (offset < report.finding_page.total_count) {
        const value = await boundary.execute("analyze_repertoire_congruence", {
          sort: "finding-id",
          page: { offset, limit: STRATEGIC_FIT_MAX_PAGE_SIZE },
        }, { signal: controller.signal });
        if (controller.signal.aborted || sequence !== loadSequence) return;
        const page = validPage(
          value,
          report.report_id,
          report.repertoire_revision,
          offset,
          report.finding_page.total_count,
        );
        for (const finding of page.findings) {
          if (seenIds.has(finding.finding_id)) {
            throw new Error("The finding page repeated an existing finding identity.");
          }
          seenIds.add(finding.finding_id);
          all.push(finding);
        }
        offset += page.finding_page.returned_count;
      }
      if (controller.signal.aborted || sequence !== loadSequence) return;
      setState((previous) => previous.report_id === report.report_id
        ? {
            ...previous,
            status: "ready",
            findings: all,
            canonical_total_count: report.finding_page.total_count,
            error: null,
          }
        : previous);
    } catch (error) {
      if (controller.signal.aborted || sequence !== loadSequence) return;
      setState((previous) => previous.report_id === report.report_id
        ? {
            ...previous,
            status: "error",
            findings: [],
            error: error instanceof Error ? error.message : String(error),
          }
        : previous);
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  const synchronize = async (
    report: StrategicFitAnalysisResult | null,
    intent?: StrategicFitFindingQueueIntent | null,
  ) => {
    if (report === null) {
      activeController?.abort();
      activeController = null;
      loadSequence++;
      setState(initialSnapshot());
      return;
    }

    const appliedIntent = currentIntent(report.report_id, intent);
    const previous = state();
    if (previous.report_id === report.report_id) {
      if (!sameIntent(previous.intent, appliedIntent)) {
        resetPageAndSelection({
          intent: appliedIntent,
          priority_kind: "replacement",
          priority_filter: "all",
          opening_filter: "",
        });
      }
      return;
    }

    activeController?.abort();
    const sequence = ++loadSequence;
    const needsCompleteReload = report.finding_page.has_more ||
      report.findings.length < report.finding_page.total_count;
    setState({
      ...initialSnapshot(),
      report_id: report.report_id,
      repertoire_revision: report.repertoire_revision,
      status: needsCompleteReload ? "loading" : "ready",
      findings: needsCompleteReload ? [] : [...report.findings],
      canonical_total_count: report.finding_page.total_count,
      intent: appliedIntent,
    });
    if (!needsCompleteReload) return;

    const controller = new AbortController();
    activeController = controller;
    await loadCompleteReport(report, sequence, controller);
  };

  return {
    snapshot: state,
    view: () => buildStrategicFitFindingQueueView(state()),
    synchronize,
    setSort: (sort) => resetPageAndSelection({ sort }),
    setPriorityKind: (priority_kind) => resetPageAndSelection({ priority_kind }),
    setPriorityFilter: (priority_filter) => resetPageAndSelection({ priority_filter }),
    setOpeningFilter: (opening_filter) => resetPageAndSelection({ opening_filter }),
    setPageOffset: (requestedOffset) => {
      const current = buildStrategicFitFindingQueueView(state());
      const lastOffset = current.page.total_count === 0
        ? 0
        : Math.floor((current.page.total_count - 1) / STRATEGIC_FIT_QUEUE_PAGE_SIZE) *
          STRATEGIC_FIT_QUEUE_PAGE_SIZE;
      setState((previous) => ({
        ...previous,
        page_offset: Math.min(Math.max(0, Math.floor(requestedOffset)), lastOffset),
        selected_finding_id: null,
      }));
    },
    selectFinding: (selected_finding_id) => setState((previous) => ({
      ...previous,
      selected_finding_id: selected_finding_id !== null &&
        previous.findings.some((finding) => finding.finding_id === selected_finding_id)
        ? selected_finding_id
        : null,
    })),
    dispose: () => {
      activeController?.abort();
      activeController = null;
      loadSequence++;
      setState(initialSnapshot());
    },
  };
}

export const strategicFitFindingQueue = createStrategicFitFindingQueueState({
  execute: (command, args, options) => executeDirectBrowserCommand(command, args, options),
});
