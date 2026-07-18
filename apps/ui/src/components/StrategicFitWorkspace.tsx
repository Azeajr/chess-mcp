import { For, Show, onCleanup, onMount } from "solid-js";
import {
  setStrategicFitWorkspaceOpen,
  setStrategicFitWorkspaceStage,
  strategicFitWorkspaceRegions,
  strategicFitWorkspaceStage,
  type StrategicFitWorkspaceRegionState,
  type StrategicFitWorkspaceStage,
} from "../store/ui";

const STAGES: readonly { id: StrategicFitWorkspaceStage; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "evidence", label: "Evidence" },
  { id: "resolution", label: "Resolution" },
];

const EMPTY_COPY: Record<StrategicFitWorkspaceStage, { title: string; detail: string }> = {
  overview: {
    title: "No strategic map yet",
    detail: "Opening this workspace does not start an analysis.",
  },
  findings: {
    title: "No findings to review",
    detail: "Findings will appear here only after a Strategic Fit analysis is requested.",
  },
  evidence: {
    title: "No evidence selected",
    detail: "Select a future finding to compare its branch with the cohort baseline.",
  },
  resolution: {
    title: "No resolution selected",
    detail: "Resolution choices will become available when a finding is under review.",
  },
};

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function RegionState(props: {
  region: StrategicFitWorkspaceStage;
  state: StrategicFitWorkspaceRegionState;
}) {
  const copy = () => EMPTY_COPY[props.region];
  return (
    <div
      class={`strategic-fit-region-state strategic-fit-region-${props.state.status}`}
      data-region-state={props.state.status}
      role={props.state.status === "error" ? "alert" : props.state.status === "loading" ? "status" : undefined}
      aria-live={props.state.status === "loading" ? "polite" : undefined}
    >
      <Show when={props.state.status === "empty"}>
        <strong>{copy().title}</strong>
        <p>{props.state.message ?? copy().detail}</p>
      </Show>
      <Show when={props.state.status === "loading"}>
        <span class="strategic-fit-region-spinner" aria-hidden="true" />
        <div>
          <strong>Loading workspace data</strong>
          <p>{props.state.message ?? "This region is waiting for Strategic Fit data."}</p>
        </div>
      </Show>
      <Show when={props.state.status === "error"}>
        <strong>Workspace data unavailable</strong>
        <p>{props.state.message ?? "This region could not be displayed."}</p>
      </Show>
    </div>
  );
}

export default function StrategicFitWorkspace() {
  let dialog!: HTMLElement;
  let closeButton!: HTMLButtonElement;
  let returnFocus: HTMLElement | null = null;

  const close = () => setStrategicFitWorkspaceOpen(false);
  const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");

  onMount(() => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const candidates = focusable();
      if (candidates.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = candidates[0]!;
      const last = candidates[candidates.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus, true);
    closeButton.focus();
    onCleanup(() => {
      document.removeEventListener("keydown", trapFocus, true);
      queueMicrotask(() => returnFocus?.isConnected && returnFocus.focus());
    });
  });

  return (
    <div class="strategic-fit-workspace-backdrop">
      <section
        ref={dialog}
        class="strategic-fit-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strategic-fit-workspace-title"
        aria-describedby="strategic-fit-workspace-description"
        tabIndex={-1}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header class="strategic-fit-workspace-header">
          <div>
            <div class="strategic-fit-workspace-kicker">Repertoire review</div>
            <h1 id="strategic-fit-workspace-title">Strategic Fit</h1>
            <p id="strategic-fit-workspace-description">
              Review strategic workload without changing the working repertoire.
            </p>
          </div>
          <div class="strategic-fit-workspace-header-actions">
            <span class="strategic-fit-workspace-status">Analysis not started</span>
            <button ref={closeButton} type="button" onClick={close}>Return to repertoire</button>
          </div>
        </header>

        <nav class="strategic-fit-stage-nav" aria-label="Strategic Fit stages" role="tablist">
          <For each={STAGES}>{(stage) => (
            <button
              id={`strategic-fit-stage-${stage.id}`}
              type="button"
              role="tab"
              aria-controls={`strategic-fit-pane-${stage.id}`}
              aria-selected={strategicFitWorkspaceStage() === stage.id}
              tabIndex={strategicFitWorkspaceStage() === stage.id ? 0 : -1}
              class={strategicFitWorkspaceStage() === stage.id ? "active" : ""}
              onClick={() => setStrategicFitWorkspaceStage(stage.id)}
            >{stage.label}</button>
          )}</For>
        </nav>

        <main class="strategic-fit-workspace-body" data-stage={strategicFitWorkspaceStage()}>
          <section
            id="strategic-fit-pane-overview"
            class="strategic-fit-workspace-pane strategic-fit-overview-pane"
            aria-labelledby="strategic-fit-pane-overview-title"
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Overview</span>
              <h2 id="strategic-fit-pane-overview-title">Strategic map</h2>
            </div>
            <RegionState region="overview" state={strategicFitWorkspaceRegions().overview} />
          </section>

          <section
            id="strategic-fit-pane-findings"
            class="strategic-fit-workspace-pane strategic-fit-findings-pane"
            aria-labelledby="strategic-fit-pane-findings-title"
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Review queue</span>
              <h2 id="strategic-fit-pane-findings-title">Findings</h2>
            </div>
            <RegionState region="findings" state={strategicFitWorkspaceRegions().findings} />
          </section>

          <section
            id="strategic-fit-pane-evidence"
            class="strategic-fit-workspace-pane strategic-fit-evidence-pane"
            aria-labelledby="strategic-fit-pane-evidence-title"
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Branch review</span>
              <h2 id="strategic-fit-pane-evidence-title">Evidence / comparison</h2>
            </div>
            <RegionState region="evidence" state={strategicFitWorkspaceRegions().evidence} />
          </section>

          <section
            id="strategic-fit-pane-resolution"
            class="strategic-fit-workspace-pane strategic-fit-resolution-pane"
            aria-labelledby="strategic-fit-pane-resolution-title"
            tabIndex={0}
          >
            <div class="strategic-fit-pane-heading">
              <span>Next step</span>
              <h2 id="strategic-fit-pane-resolution-title">Resolution</h2>
            </div>
            <RegionState region="resolution" state={strategicFitWorkspaceRegions().resolution} />
          </section>
        </main>
      </section>
    </div>
  );
}
