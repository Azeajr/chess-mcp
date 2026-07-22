import { Show, createEffect, createSignal } from "solid-js";
import type { StrategicFinding, StrategicFitReport } from "@chess-mcp/chess-tools";
import { saveArtifact } from "../../store/artifacts";
import { displayStrategicFitFindingResolution } from "../../store/strategic-fit-finding-resolutions";
import { strategicFitMetadata } from "../../store/strategic-fit-metadata";
import {
  createStrategicFitTrainingItem,
  type StrategicFitTrainingCreationResult,
} from "../../store/strategic-fit-training";

export default function TrainException(props: {
  reportId: string;
  report: StrategicFitReport;
  finding: StrategicFinding;
}) {
  const [notes, setNotes] = createSignal("");
  const [result, setResult] = createSignal<StrategicFitTrainingCreationResult | null>(null);

  createEffect(() => {
    props.finding.finding_id;
    const resolution = strategicFitMetadata().resolutions.find((entry) =>
      entry.record_state === "active" &&
      entry.semantic_finding_id === props.finding.semantic_finding_id &&
      entry.state === "train-as-exception"
    );
    setNotes(resolution?.note ?? "");
    setResult(null);
  });

  const resolution = () => displayStrategicFitFindingResolution(props.finding);
  const activeReference = () => {
    const active = strategicFitMetadata().resolutions.find((entry) =>
      entry.record_state === "active" &&
      entry.semantic_finding_id === props.finding.semantic_finding_id &&
      entry.state === "train-as-exception"
    );
    const trainingId = active?.linked_training_ids[0];
    return trainingId === undefined
      ? null
      : strategicFitMetadata().training_references.find((entry) => entry.training_id === trainingId) ?? null;
  };
  const input = () => ({
    report_id: props.reportId,
    finding_id: props.finding.finding_id,
    semantic_finding_id: props.finding.semantic_finding_id,
    user_notes: notes(),
  });
  const create = () => setResult(createStrategicFitTrainingItem(input()));

  return (
    <Show when={resolution() === "unresolved" || resolution() === "train-as-exception"}>
      <section
        class="strategic-fit-training"
        aria-labelledby={`strategic-fit-training-heading-${props.finding.finding_id}`}
        data-training-finding-id={props.finding.finding_id}
        data-training-report-revision={props.report.repertoire_revision}
      >
        <header>
          <span>Train the exception</span>
          <h3 id={`strategic-fit-training-heading-${props.finding.finding_id}`}>
            Build a basic drill
          </h3>
          <p>
            Use the finding’s legal checkpoints, deterministic concepts, and causal move. No AI is required.
          </p>
        </header>

        <Show when={resolution() === "unresolved"} fallback={(
          <div class="strategic-fit-training-current" data-training-record-id={activeReference()?.training_id}>
            <p><strong>Training item saved.</strong> The finding remains on the strategic map.</p>
            <Show when={activeReference()}>{(reference) => (
              <dl>
                <dt>Semantic positions</dt>
                <dd>{reference().references.position_ids.length}</dd>
                <dt>Created</dt>
                <dd>{reference().created_at}</dd>
              </dl>
            )}</Show>
          </div>
        )}>
          <label class="strategic-fit-resolution-field">
            Optional training notes
            <textarea
              rows={3}
              maxLength={2000}
              value={notes()}
              onInput={(event) => setNotes(event.currentTarget.value)}
            />
          </label>
          <p>
            Creating this item records a reversible training resolution and does not edit repertoire lines.
          </p>
          <button type="button" onClick={create}>Create training item</button>
        </Show>

        <Show when={result()?.message}>{(message) => (
          <p
            class="strategic-fit-training-feedback"
            role={result()?.state === "blocked" ? "alert" : "status"}
          >{message()}</p>
        )}</Show>
        <Show when={result()?.record}>{(record) => (
          <p class="strategic-fit-training-detail">
            {record().drills.length} legal drill {record().drills.length === 1 ? "position" : "positions"}
            {record().concept_ids.length > 0
              ? ` · ${record().concept_ids.length} concept ${record().concept_ids.length === 1 ? "ID" : "IDs"}`
              : " · concepts unavailable"}
            {record().causal_move === null
              ? " · causal move unavailable"
              : ` · causal move ${record().causal_move?.san ?? "unavailable"}`}
          </p>
        )}</Show>
        <Show when={result()?.artifact_id}>{(artifactId) => (
          <button type="button" onClick={() => saveArtifact(artifactId())}>
            Save basic drill JSON
          </button>
        )}</Show>
      </section>
    </Show>
  );
}
