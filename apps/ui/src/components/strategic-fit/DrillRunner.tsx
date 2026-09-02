/**
 * The drill attempt surface. Shows one drill position at a time, takes a single move, and records
 * what actually happened.
 *
 * Two rules from the training model are load-bearing here. Recall is first-attempt only, so a
 * wrong move is revealed and recorded rather than retried — a retry that overwrote the first result
 * would make recall rate meaningless. And an attempt is recorded only from a move the user really
 * played: nothing on this screen may report recall for a drill that was merely created.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { recordStrategicFitDrillAttempt } from "../../store/strategic-fit-training";
import DrillBoard, { sanForDrillMove } from "./DrillBoard";

interface RunnerDrill {
  readonly drill_id: string;
  readonly position_id: string;
  readonly decision_id: string;
  readonly fen: string;
  readonly expected_san: string;
}

interface Outcome {
  readonly drillId: string;
  readonly playedSan: string | null;
  readonly recalled: boolean;
  readonly responseTimeMs: number;
  readonly recorded: boolean;
}

export default function DrillRunner(props: { trainingId: string; drills: readonly RunnerDrill[] }) {
  const [index, setIndex] = createSignal(0);
  const [outcomes, setOutcomes] = createSignal<Outcome[]>([]);
  const [shownAt, setShownAt] = createSignal(Date.now());

  const current = () => props.drills[index()] ?? null;
  const answered = createMemo(() => outcomes().find((o) => o.drillId === current()?.drill_id));
  const finished = () => index() >= props.drills.length;
  const recalledCount = () => outcomes().filter((o) => o.recalled).length;

  const play = (orig: string, dest: string) => {
    const drill = current();
    if (!drill || answered()) return;

    const responseTimeMs = Math.max(0, Date.now() - shownAt());
    const playedSan = sanForDrillMove(drill.fen, orig, dest);
    const recalled = playedSan === drill.expected_san;

    const result = recordStrategicFitDrillAttempt({
      trainingId: props.trainingId,
      drill,
      recalled,
      responseTimeMs,
    });

    setOutcomes([
      ...outcomes(),
      { drillId: drill.drill_id, playedSan, recalled, responseTimeMs, recorded: result !== null },
    ]);
  };

  const advance = () => {
    setIndex(index() + 1);
    setShownAt(Date.now());
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
                    {outcome.recalled ? "Recalled" : "Missed"} ·{" "}
                    {Math.round(outcome.responseTimeMs / 100) / 10}s
                    <Show when={!outcome.recorded}>
                      {" "}
                      ·{" "}
                      <span data-drill-unrecorded="true">not recorded (target not registered)</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </div>
        }
      >
        <Show when={current()}>
          {(drill) => (
            <div
              class="strategic-fit-drill-active"
              data-drill-id={drill().drill_id}
              /* Test hooks, like `data-app-live-region`: an e2e cannot otherwise know which move to
                 play. The prepared move being visible in the DOM is acceptable here — it is the
                 user's own repertoire, and the drill reveals it on a miss anyway. */
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
                            Not recalled. You played {outcome().playedSan ?? "an illegal move"}; the
                            prepared move is {drill().expected_san}.
                          </>
                        }
                      >
                        Recalled {drill().expected_san} in{" "}
                        {Math.round(outcome().responseTimeMs / 100) / 10}s.
                      </Show>
                    </p>
                    <button type="button" onClick={advance} data-drill-advance="true">
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
