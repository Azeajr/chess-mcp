import { For, Show, onMount } from "solid-js";
import {
  advanceStrategicFitDrillSession,
  playStrategicFitDrill,
  refreshStrategicFitDrillClock,
  startStrategicFitDrillSession,
  strategicFitDrillOutcomeFor,
  strategicFitDrillSession,
} from "../../store/strategic-fit-training";
import DrillBoard from "./DrillBoard";

interface RunnerDrill {
  readonly drill_id: string;
  readonly position_id: string;
  readonly decision_id: string;
  readonly fen: string;
  readonly expected_san: string;
}

const seconds = (ms: number) => Math.round(ms / 100) / 10;

export default function DrillRunner(props: { trainingId: string; drills: readonly RunnerDrill[] }) {
  const session = () => strategicFitDrillSession(props.trainingId);
  const index = () => session()?.index ?? 0;
  const outcomes = () => session()?.outcomes ?? [];

  const current = () => props.drills[index()] ?? null;
  const answered = () => strategicFitDrillOutcomeFor(session(), current()?.drill_id);
  const finished = () => index() >= props.drills.length;
  const recalledCount = () => outcomes().filter((outcome) => outcome.recalled).length;

  onMount(() => {
    if (answered() === undefined) refreshStrategicFitDrillClock(props.trainingId);
  });

  const play = (orig: string, dest: string) => {
    const drill = current();
    if (!drill) return;
    playStrategicFitDrill({ trainingId: props.trainingId, drill, orig, dest });
  };

  return (
    <div class="strategic-fit-drill-runner" data-drill-runner="true">
      <Show
        when={!finished()}
        fallback={
          <div class="strategic-fit-drill-summary" data-drill-summary="true" role="status">
            <p>
              Drilled {outcomes().length} of {props.drills.length} · recalled {recalledCount()}
            </p>
            <ul>
              <For each={outcomes()}>
                {(outcome) => (
                  <li data-drill-outcome={outcome.recalled ? "recalled" : "missed"}>
                    {outcome.recalled ? "Recalled" : "Missed"} · {seconds(outcome.response_time_ms)}
                    s
                    <Show when={!outcome.recorded}>
                      {" "}
                      ·{" "}
                      <span data-drill-unrecorded={outcome.unrecorded_reason ?? "true"}>
                        {outcome.unrecorded_reason === "attempt-refused"
                          ? "not recorded (attempt refused)"
                          : "not recorded (target not registered)"}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <button
              type="button"
              onClick={() => {
                startStrategicFitDrillSession(props.trainingId);
              }}
              data-drill-restart="true"
            >
              Drill again
            </button>
          </div>
        }
      >
        <Show when={current()}>
          {(drill) => (
            <div
              class="strategic-fit-drill-active"
              data-drill-id={drill().drill_id}
              data-drill-fen={drill().fen}
              data-drill-expected={drill().expected_san}
            >
              <p class="strategic-fit-drill-prompt">
                Position {index() + 1} of {props.drills.length}. Play the move you prepared here.
              </p>
              <DrillBoard
                fen={drill().fen}
                onMove={play}
                locked={answered() !== undefined}
                label={`Drill position ${String(index() + 1)}`}
              />
              <Show when={answered()}>
                {(outcome) => (
                  <div class="strategic-fit-drill-result">
                    <p role="status" data-drill-result={outcome().recalled ? "recalled" : "missed"}>
                      <Show
                        when={outcome().recalled}
                        fallback={
                          <>
                            Not recalled. You played {outcome().played_san ?? "an illegal move"};
                            the prepared move is {drill().expected_san}.
                          </>
                        }
                      >
                        Recalled {drill().expected_san} in {seconds(outcome().response_time_ms)}s.
                      </Show>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        advanceStrategicFitDrillSession(props.trainingId);
                      }}
                      data-drill-advance="true"
                    >
                      {index() + 1 < props.drills.length ? "Next position" : "Finish"}
                    </button>
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
