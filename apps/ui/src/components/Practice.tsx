import { For, Show, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { buildRepertoireGraph, type OnlyMoveFinding } from "@chess-mcp/chess-tools";
import { currentTree, color, documentId, version } from "../store/game";
import { commandStates, commandIsStale } from "../store/commands";
import {
  startStrategicFitDrillSession,
  strategicFitTrainingPerformance,
} from "../store/strategic-fit-training";
import Dialog from "./primitives/Dialog";
import DrillRunner from "./strategic-fit/DrillRunner";

interface PracticeItem {
  trainingId: string;
  drill: {
    drill_id: string;
    position_id: string;
    decision_id: string;
    fen: string;
    expected_san: string;
  };
  misses: number;
}

/** Resolve saved semantic targets against today's tree; removed moves are never drilled. */
export function practiceItems(): PracticeItem[] {
  const graph = buildRepertoireGraph(currentTree(), color());
  const performance = strategicFitTrainingPerformance();
  return performance.targets
    .flatMap((target) => {
      const decision = graph.decisions.find(
        (entry) =>
          entry.decision_id === target.decision_id &&
          entry.from_position_id === target.position_id &&
          entry.owner === "repertoire",
      );
      const position = graph.positions.find((entry) => entry.position_id === target.position_id);
      if (!decision || !position) return [];
      return [
        {
          trainingId: target.training_id,
          drill: {
            drill_id: target.target_id,
            position_id: target.position_id,
            decision_id: target.decision_id,
            fen: position.fen,
            expected_san: decision.san,
          },
          misses: performance.attempts.filter(
            (attempt) => attempt.target_id === target.target_id && !attempt.recalled,
          ).length,
        },
      ];
    })
    .sort((a, b) => b.misses - a.misses);
}

export default function Practice() {
  const [open, setOpen] = createSignal(false);
  const [items, setItems] = createSignal<PracticeItem[]>([]);
  const [index, setIndex] = createSignal(0);
  const [source, setSource] = createSignal({ document: "", revision: -1 });
  const current = () => items()[index()];
  const fresh = () => source().document === documentId() && source().revision === version();
  const begin = (next: PracticeItem[]) => {
    setSource({ document: documentId(), revision: version() });
    setItems(next);
    setIndex(0);
    if (next[0]) startStrategicFitDrillSession(next[0].trainingId);
    setOpen(true);
  };
  const advance = () => {
    const next = items()[index() + 1];
    if (next) startStrategicFitDrillSession(next.trainingId);
    setIndex((at) => at + 1);
  };
  const onlyMoves = () =>
    commandIsStale("find_only_moves")
      ? []
      : ((commandStates().find_only_moves.result?.findings as OnlyMoveFinding[] | undefined) ?? []);
  return (
    <>
      <button
        onClick={() => {
          if (!fresh() || !current()) begin(practiceItems());
          else setOpen(true);
        }}
      >
        Practice
      </button>
      <Show when={open()}>
        <Portal>
          <Dialog title="Practice" onClose={() => setOpen(false)}>
            <button onClick={() => setOpen(false)}>Close practice</button>
            <p>
              Saved training positions, most missed first. Your first move counts; correct answers
              advance automatically.
            </p>
            <Show
              when={fresh()}
              fallback={<p>Repertoire changed. Start a fresh practice session.</p>}
            >
              <Show
                when={current()}
                keyed
                fallback={
                  <p role="status">
                    {items().length
                      ? "Practice complete."
                      : "No saved training positions in this repertoire. Create a training item in Strategic Fit, or find only moves."}
                  </p>
                }
              >
                {(item) => (
                  <>
                    <p>
                      Practice position {index() + 1} of {items().length}
                    </p>
                    <DrillRunner
                      trainingId={item.trainingId}
                      drills={[item.drill]}
                      onComplete={advance}
                    />
                  </>
                )}
              </Show>
            </Show>
            <button
              onClick={() => {
                begin(practiceItems());
              }}
            >
              Restart saved practice
            </button>
            <Show when={onlyMoves().length}>
              <button
                onClick={() => {
                  begin(
                    onlyMoves().map((finding, at) => ({
                      trainingId: `only-move:${documentId()}:${at}`,
                      misses: 0,
                      drill: {
                        drill_id: `only-${at}`,
                        position_id: "",
                        decision_id: "",
                        fen: finding.fen,
                        expected_san: finding.best_move,
                      },
                    })),
                  );
                }}
              >
                Practice latest only moves
              </button>
              <p>Only-move practice is session-only; it does not record Strategic Fit mastery.</p>
            </Show>
            <details>
              <summary>Saved training positions</summary>
              <For each={practiceItems()}>
                {(item) => (
                  <p>
                    {item.drill.expected_san} · {item.misses} misses
                  </p>
                )}
              </For>
            </details>
          </Dialog>
        </Portal>
      </Show>
    </>
  );
}
