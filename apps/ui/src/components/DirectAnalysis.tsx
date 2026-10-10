import { For, Show } from "solid-js";
import { currentTree } from "../store/game";
import {
  commandStates,
  cancelCommand,
  commandIsStale,
  rerunCommand,
  type DirectCommand,
} from "../store/commands";
import { setSettingsFocusTarget } from "../store/settings";
import { setSettingsOpen } from "../store/ui";
import ToolResult from "./ToolResult";
import ReviewFindings from "./ReviewFindings";
import ExportSaveControl from "./ExportSaveControl";
import {
  reviewGame,
  comparePosition,
  compareWithHistory,
  generateExport,
  importHistory,
  importNotice,
  lookUpPosition,
} from "../application/analysis-workflows";
import {
  historyMonth,
  historyPlatform,
  historyUsername,
  setHistoryMonth,
  setHistoryPlatform,
  setHistoryUsername,
} from "../store/forms";
import {
  comparisonDraft,
  setComparisonDraft,
  comparisonOpen,
  setComparisonOpen,
  selectedReview,
} from "../store/guided-ui";

export const isSingleGame = () => currentTree().stats().leaves === 1;

export default function DirectAnalysis() {
  const state = (command: DirectCommand) => commandStates()[command];
  const results = (commands: DirectCommand[]) => (
    <For each={commands}>
      {(command) => (
        <>
          <Show when={state(command).status === "running"}>
            <p role="status">
              Working… {state(command).progress?.done} / {state(command).progress?.total}
            </p>
            <button
              onClick={() => {
                cancelCommand(command);
              }}
            >
              Cancel {command.replaceAll("_", " ")}
            </button>
          </Show>
          <Show when={commandIsStale(command)}>
            <p>
              Out of date — re-run{" "}
              <button onClick={() => void rerunCommand(command)}>
                Re-run {command.replaceAll("_", " ")}
              </button>
            </p>
          </Show>
          {/* An export's artifact is shown once, by its Save control above. */}
          <Show
            when={
              state(command).result &&
              !commandIsStale(command) &&
              command !== "export_annotated_pgn"
            }
          >
            <Show when={command === "compare_moves" && Array.isArray(state(command).args?.moves)}>
              <p>Compared candidates: {(state(command).args?.moves as string[]).join(", ")}</p>
            </Show>
            <Show
              when={command === "analyze_game" && state(command).resultId && !state(command).error}
              fallback={
                <ToolResult operation={command} content={JSON.stringify(state(command).result)} />
              }
            >
              <ReviewFindings
                resultId={state(command).resultId ?? ""}
                result={state(command).result ?? {}}
              />
            </Show>
          </Show>
          <Show when={state(command).error && !state(command).result}>
            <p role="alert">{state(command).error}</p>
          </Show>
          <Show when={state(command).error === "explorer_auth_required"}>
            <button
              onClick={() => {
                setSettingsFocusTarget("lichess-token");
                setSettingsOpen(true);
              }}
            >
              Set up explorer token
            </button>
          </Show>
        </>
      )}
    </For>
  );
  return (
    <section
      class="direct-analysis"
      aria-label="Game and position tools"
      data-guided-surface="analysis.review"
    >
      <Show when={isSingleGame()}>
        <button
          disabled={
            state("get_game_summary").status === "running" ||
            state("analyze_game").status === "running"
          }
          onClick={() => void reviewGame()}
        >
          Review game
        </button>
        <button
          data-guided-surface="analysis.export"
          disabled={state("export_annotated_pgn").status === "running"}
          onClick={() => void generateExport("export_annotated_pgn", "user")}
        >
          Export annotated game
        </button>
      </Show>
      <ExportSaveControl
        command="export_annotated_pgn"
        saveLabel="Save annotated game"
        againLabel="Download annotated game again"
      />
      <Show
        when={
          selectedReview()?.resultId === state("analyze_game").resultId &&
          selectedReview() &&
          !commandIsStale("analyze_game")
        }
      >
        <p role="status">Showing the position before reviewed move {selectedReview()?.ply}.</p>
      </Show>
      {results(["get_game_summary", "analyze_game", "export_annotated_pgn"])}
      <details
        data-guided-surface="analysis.compare"
        open={comparisonOpen()}
        onToggle={(event) => setComparisonOpen(event.currentTarget.open)}
      >
        <summary>Compare moves and position tools</summary>
        <label>
          Candidate moves{" "}
          <input
            value={comparisonDraft()}
            placeholder="Automatic, or e4 d4 Nf3"
            onInput={(event) => {
              setComparisonDraft(event.currentTarget.value);
            }}
          />
        </label>
        <button
          disabled={
            state("compare_moves").status === "running" ||
            state("evaluate_position").status === "running"
          }
          onClick={() => void comparePosition()}
        >
          Compare moves
        </button>
        <button onClick={() => void lookUpPosition("tablebase_lookup")}>Tablebase</button>
        <button onClick={() => void lookUpPosition("position_popularity")}>
          Position popularity
        </button>
        {results(["evaluate_position", "compare_moves", "tablebase_lookup", "position_popularity"])}
      </details>
      <details data-guided-surface="analysis.history">
        <summary>Prepare · Import my games</summary>
        <label>
          Platform{" "}
          <select
            value={historyPlatform()}
            onChange={(event) => {
              setHistoryPlatform(event.currentTarget.value === "chesscom" ? "chesscom" : "lichess");
            }}
          >
            <option value="lichess">Lichess</option>
            <option value="chesscom">Chess.com</option>
          </select>
        </label>
        <label>
          Username{" "}
          <input
            value={historyUsername()}
            onInput={(event) => {
              setHistoryUsername(event.currentTarget.value);
            }}
          />
        </label>
        <Show when={historyPlatform() === "chesscom"}>
          <label>
            Month{" "}
            <input
              type="month"
              value={historyMonth()}
              onInput={(event) => {
                setHistoryMonth(event.currentTarget.value);
              }}
            />
          </label>
        </Show>
        <button
          disabled={
            !historyUsername().trim() ||
            state("lichess_games").status === "running" ||
            state("chesscom_games").status === "running" ||
            state("batch_review").status === "running"
          }
          onClick={() => void importHistory()}
        >
          Import and review games
        </button>
        <button disabled={!historyUsername().trim()} onClick={() => void compareWithHistory()}>
          Compare with my history
        </button>
        <p>Fetches public games from the selected service. Does not replace your repertoire.</p>
        <Show when={importNotice()}>
          {(notice) => (
            <p role={notice().tone} data-import-notice={notice().tone}>
              {notice().message}
            </p>
          )}
        </Show>
        {results(["lichess_games", "chesscom_games", "batch_review", "repertoire_vs_history"])}
      </details>
    </section>
  );
}
