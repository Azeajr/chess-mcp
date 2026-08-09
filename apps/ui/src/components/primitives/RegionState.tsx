import { Show } from "solid-js";

export type RegionStateStatus = "empty" | "loading" | "error";

export interface RegionStateProps {
  status?: RegionStateStatus;
  title?: string;
  message?: string;
  region?: string;
  state?: { status: RegionStateStatus; message?: string };
}

const REGION_COPY: Record<string, { title: string; detail: string }> = {
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

export default function RegionState(props: RegionStateProps) {
  const status = () => props.status ?? props.state?.status ?? "empty";
  const copy = () => REGION_COPY[props.region ?? ""];
  const title = () =>
    props.title ??
    (status() === "loading"
      ? "Loading workspace data"
      : status() === "error"
        ? "Workspace data unavailable"
        : (copy()?.title ?? "No data yet"));
  const message = () =>
    props.message ??
    props.state?.message ??
    (status() === "loading"
      ? "This region is waiting for Strategic Fit data."
      : status() === "error"
        ? "This region could not be displayed."
        : (copy()?.detail ?? "This region is waiting for data."));
  return (
    <div
      class={`ui-region-state ui-region-state-${status()}`}
      data-region-state={status()}
      role={status() === "error" ? "alert" : status() === "loading" ? "status" : undefined}
    >
      <Show when={status() === "loading"}>
        <span class="ui-region-spinner" aria-hidden="true" />
      </Show>
      <div>
        <strong>{title()}</strong>
        <p>{message()}</p>
      </div>
    </div>
  );
}
