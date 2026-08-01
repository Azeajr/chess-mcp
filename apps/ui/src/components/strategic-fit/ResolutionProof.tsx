import { For, Show, createEffect } from "solid-js";
import {
  strategicFitResolutionProof,
  strategicFitResolutionProofSnapshot,
  type StrategicFitResolutionProofMetricClaim,
  type StrategicFitResolutionProofSnapshot,
} from "../../store/strategic-fit-resolution-proof";

export const PROOF_STATUS_LABELS: Readonly<
  Record<StrategicFitResolutionProofSnapshot["status"], string>
> = {
  idle: "No accepted change",
  "awaiting-rescan": "Awaiting affected-cohort rescan",
  rescanning: "Rescanning affected cohorts",
  proven: "Post-rescan result available",
  superseded: "Evidence superseded by another edit",
  "rescan-failed": "Rescan failed",
  "rescan-cancelled": "Rescan cancelled",
  undoing: "Undoing accepted change",
  "undo-blocked": "Undo rejected",
  undone: "Undo applied and rescanned",
};

const NO_CLAIM_STATUSES: ReadonlySet<StrategicFitResolutionProofSnapshot["status"]> = new Set([
  "awaiting-rescan",
  "rescanning",
  "superseded",
  "rescan-failed",
  "rescan-cancelled",
  "undoing",
  "undo-blocked",
]);

export function proofClaimText(metric: StrategicFitResolutionProofMetricClaim["before"]): string {
  if (metric === null) return "unavailable: no pre-change report was retained";
  if (metric.state !== "available" || metric.value === null) {
    return `${metric.state}${metric.reason === null ? "" : `: ${metric.reason}`}`;
  }
  const value =
    metric.unit === "fraction" ? `${(metric.value * 100).toFixed(1)}%` : metric.value.toFixed(3);
  return `${value} (${metric.unit})`;
}

export function proofMakesNoResolutionClaim(
  status: StrategicFitResolutionProofSnapshot["status"],
): boolean {
  return NO_CLAIM_STATUSES.has(status);
}

export default function ResolutionProof() {
  const state = strategicFitResolutionProofSnapshot;
  createEffect(() => {
    strategicFitResolutionProof.synchronize();
  });
  const alerting = () => ["superseded", "rescan-failed", "undo-blocked"].includes(state().status);
  const outcome = () => state().outcome;
  const undoAvailable = () =>
    state().phase === "acceptance" &&
    state().undo_record?.status === "available" &&
    !["undoing", "undone", "idle"].includes(state().status);
  return (
    <Show when={state().tracked} keyed>
      {(tracked) => (
        <section
          class="replacement-resolution-proof"
          aria-labelledby="replacement-resolution-proof-title"
          data-proof-status={state().status}
          data-proof-phase={state().phase}
        >
          <header>
            <div>
              <span>5. Post-acceptance verification</span>
              <h4 id="replacement-resolution-proof-title">Rescan and resolution proof</h4>
            </div>
            <code>{tracked.stage_id}</code>
          </header>
          <div
            class="replacement-proof-status"
            role={alerting() ? "alert" : "status"}
            aria-live="polite"
          >
            <strong>{PROOF_STATUS_LABELS[state().status]}</strong>
            <Show when={proofMakesNoResolutionClaim(state().status)}>
              <span>
                {" "}
                No success or resolution claim is made before a completed rescan binds to revision
                evidence.
              </span>
            </Show>
            <Show when={state().superseded_reason}>{(reason) => <span> {reason()}</span>}</Show>
            <Show when={state().error}>
              {(error) => (
                <span>
                  {" "}
                  <code>{error().code}</code>: {error().message}
                </span>
              )}
            </Show>
          </div>

          <dl class="replacement-proof-identities">
            <div>
              <dt>Accepted stage</dt>
              <dd>
                <code>{tracked.stage_id}</code>
              </dd>
            </div>
            <div>
              <dt>Accepted revision</dt>
              <dd>
                {tracked.accepted_revision} (from {tracked.base_revision})
              </dd>
            </div>
            <div>
              <dt>Semantic finding</dt>
              <dd>
                <code>{tracked.semantic_finding_id}</code>
              </dd>
            </div>
            <div>
              <dt>Source report</dt>
              <dd>
                <code>{tracked.report_id}</code>
              </dd>
            </div>
            <div>
              <dt>Candidate</dt>
              <dd>
                <code>{tracked.candidate_id}</code>
              </dd>
            </div>
            <div>
              <dt>Old-line retention</dt>
              <dd>
                {tracked.action_summary.archive} / {tracked.action_summary.prune}
              </dd>
            </div>
            <div>
              <dt>Repertoire owner</dt>
              <dd>{tracked.repertoire_color === "black" ? "Black" : "White"}</dd>
            </div>
          </dl>

          <Show when={outcome()} keyed>
            {(value) => (
              <div class="replacement-proof-outcome" data-proof-outcome={value.kind}>
                <Show when={value.kind === "resolved" ? value : null} keyed>
                  {(resolved) => (
                    <p>
                      <strong>Resolved.</strong> Semantic finding{" "}
                      <code>{resolved.semantic_finding_id}</code> no longer appears in the
                      post-commit report at revision <code>{resolved.resolving_revision}</code>.{" "}
                      {resolved.reconciled
                        ? "Canonical reconciliation recorded the resolving revision."
                        : "The rescan report omits the finding, but no reconciliation summary was produced; the resolution record may be absent."}
                    </p>
                  )}
                </Show>
                <Show when={value.kind === "still-open" ? value : null} keyed>
                  {(open) => (
                    <div role="alert">
                      <p>
                        <strong>Still open.</strong> The post-commit rescan reports this finding
                        again{open.changed_evidence ? " with changed evidence" : ""}; it remains
                        unresolved.
                      </p>
                      <p>
                        {open.finding.plain_language_category}: {open.finding.explanation}
                      </p>
                    </div>
                  )}
                </Show>
                <Show when={value.kind === "restored-open" ? value : null} keyed>
                  {(restored) => (
                    <p>
                      <strong>Undo verified.</strong> The post-undo report contains the original
                      finding again (<code>{restored.finding.semantic_finding_id}</code>); the
                      pre-change report state is restored.
                    </p>
                  )}
                </Show>
                <Show when={value.kind === "restored-absent" ? value : null} keyed>
                  {(restored) => (
                    <p>
                      <strong>Undo applied.</strong> The repertoire is restored, but the post-undo
                      report no longer contains semantic finding{" "}
                      <code>{restored.semantic_finding_id}</code>; evidence may have shifted.
                    </p>
                  )}
                </Show>
              </div>
            )}
          </Show>

          <Show when={state().new_findings.length > 0}>
            <section aria-labelledby="replacement-proof-new-findings-title" role="alert">
              <h5 id="replacement-proof-new-findings-title">New findings created by this change</h5>
              <ul class="replacement-proof-new-findings">
                <For each={state().new_findings}>
                  {(finding) => (
                    <li data-finding-id={finding.finding_id}>
                      <strong>{finding.plain_language_category}</strong>
                      <code>{finding.semantic_finding_id}</code>
                      <p>{finding.explanation}</p>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          <Show when={state().claims} keyed>
            {(claims) => (
              <section aria-labelledby="replacement-proof-claims-title">
                <h5 id="replacement-proof-claims-title">Report-bound coverage and metric claims</h5>
                <p>
                  Every value comes from complete reports, not from staged predictions: before{" "}
                  <code>{claims.before_report_id ?? "unavailable"}</code> (revision{" "}
                  <code>{claims.before_repertoire_revision ?? "unavailable"}</code>), after{" "}
                  <code>{claims.after_report_id}</code> (revision{" "}
                  <code>{claims.after_repertoire_revision}</code>). Values use{" "}
                  {tracked.repertoire_color === "black" ? "Black" : "White"} repertoire POV; engine
                  transport stays separately labeled White POV.
                </p>
                <div class="replacement-proof-claims-scroll">
                  <table
                    class="replacement-proof-claims"
                    aria-label="Post-commit report metric claims"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Claim</th>
                        <th scope="col">Before report</th>
                        <th scope="col">After report</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={claims.metrics}>
                        {(claim) => (
                          <tr data-claim-id={claim.claim_id}>
                            <th scope="row">{claim.label}</th>
                            <td>{proofClaimText(claim.before)}</td>
                            <td>{proofClaimText(claim.after)}</td>
                          </tr>
                        )}
                      </For>
                      <For each={claims.counts}>
                        {(claim) => (
                          <tr data-claim-id={claim.claim_id}>
                            <th scope="row">{claim.label}</th>
                            <td>
                              {claim.before ?? "unavailable: no pre-change report was retained"}
                            </td>
                            <td>{claim.after}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </Show>

          <div class="replacement-proof-actions">
            <Show
              when={state().undo_record}
              keyed
              fallback={
                <p role="status">Undo is unavailable for this accepted change in this session.</p>
              }
            >
              {(record) => (
                <>
                  <button
                    type="button"
                    disabled={!undoAvailable()}
                    onClick={() => void strategicFitResolutionProof.undo()}
                  >
                    Undo this accepted change
                  </button>
                  <small>
                    Undo record <code>{record.undo_id}</code> ({record.status}) restores revision{" "}
                    {record.base_revision} content behind one new monotonic revision, then the
                    rescan re-verifies the restored report.
                  </small>
                </>
              )}
            </Show>
          </div>
        </section>
      )}
    </Show>
  );
}
