import { For, Show, createSignal } from "solid-js";
import { currentTree, currentPath, fen, exploration } from "../store/game";
import { analysisDepth } from "../store/engine-settings";
import {
  commandStates,
  executeCommand,
  cancelCommand,
  commandIsStale,
  rerunCommand,
  type DirectCommand,
} from "../store/commands";
import { saveArtifact, type ArtifactSaveResult } from "../store/artifacts";
import ArtifactSaveStatus from "./primitives/ArtifactSaveStatus";
import { setSettingsFocusTarget } from "../store/settings";
import { setSettingsOpen } from "../store/ui";
import ToolResult from "./ToolResult";
import { preference } from "../store/preferences";

export const isSingleGame = () => currentTree().stats().leaves === 1;

export default function DirectAnalysis() {
  const [username, setUsername] = preference("chess.import.username", "");
  const [platform, setPlatform] = createSignal("lichess");
  const now = new Date();
  const [month, setMonth] = createSignal(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [comparison, setComparison] = createSignal("");
  const [saved, setSaved] = createSignal<ArtifactSaveResult | null>(null);
  const state = (command: DirectCommand) => commandStates()[command];
  const args = () => ({
    username: username().trim(),
    ...(platform() === "chesscom"
      ? { year: Number(month().split("-")[0]), month: Number(month().split("-")[1]) }
      : { max_games: 20 }),
  });
  const run = (command: DirectCommand, input = {}) =>
    executeCommand(command, {
      ...([
        "get_game_summary",
        "analyze_game",
        "export_annotated_pgn",
        "evaluate_position",
        "compare_moves",
        "batch_review",
      ].includes(command)
        ? { depth: analysisDepth() }
        : {}),
      ...input,
    });
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
          <Show when={state(command).result && !commandIsStale(command)}>
            <ToolResult operation={command} content={JSON.stringify(state(command).result)} />
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
  const review = async () => {
    if (await run("get_game_summary")) await run("analyze_game");
  };
  const compare = async () => {
    const position = fen();
    const draft = exploration();
    const candidates = comparison().trim()
      ? comparison()
          .split(/[,\s]+/)
          .filter(Boolean)
      : (draft?.tree ?? currentTree())
          .nodeAt(draft?.path ?? currentPath())
          .children.map((node) => node.data.san);
    if (!comparison().trim()) {
      const result = await run("evaluate_position", { fen: position, lines: 3 });
      if (!result || fen() !== position) return;
      if (Array.isArray(result.lines))
        for (const line of result.lines as unknown[]) {
          if (line && typeof line === "object" && "san" in line && typeof line.san === "string")
            candidates.push(line.san);
        }
    }
    await run("compare_moves", { fen: position, moves: [...new Set(candidates)] });
  };
  const importGames = async () => {
    const command = platform() === "lichess" ? "lichess_games" : "chesscom_games";
    const usernameAtStart = username().trim();
    const result = await run(command, { ...args(), include_pgn: true });
    const games = result?.games;
    if (!Array.isArray(games)) return;
    const pgn = (games as unknown[])
      .map((game) =>
        game && typeof game === "object" && "pgn" in game && typeof game.pgn === "string"
          ? game.pgn
          : "",
      )
      .filter(Boolean)
      .join("\n\n");
    if (pgn) await run("batch_review", { pgn, username: usernameAtStart, max_games: 20 });
  };
  return (
    <section class="direct-analysis" aria-label="Game and position tools">
      <Show when={isSingleGame()}>
        <button
          disabled={
            state("get_game_summary").status === "running" ||
            state("analyze_game").status === "running"
          }
          onClick={() => void review()}
        >
          Review game
        </button>
        <button
          disabled={state("export_annotated_pgn").status === "running"}
          onClick={() =>
            void run("export_annotated_pgn").then((result) => {
              const id = result?.artifact_id;
              if (typeof id === "string") setSaved(saveArtifact(id));
            })
          }
        >
          Export annotated game
        </button>
      </Show>
      <ArtifactSaveStatus result={saved()} />
      {results(["get_game_summary", "analyze_game", "export_annotated_pgn"])}
      <details>
        <summary>Compare moves and position tools</summary>
        <label>
          Candidate moves{" "}
          <input
            value={comparison()}
            placeholder="Automatic, or e4 d4 Nf3"
            onInput={(event) => setComparison(event.currentTarget.value)}
          />
        </label>
        <button
          disabled={
            state("compare_moves").status === "running" ||
            state("evaluate_position").status === "running"
          }
          onClick={() => void compare()}
        >
          Compare moves
        </button>
        <button onClick={() => void run("tablebase_lookup", { fen: fen() })}>Tablebase</button>
        <button onClick={() => void run("position_popularity", { fen: fen() })}>
          Position popularity
        </button>
        {results(["evaluate_position", "compare_moves", "tablebase_lookup", "position_popularity"])}
      </details>
      <details>
        <summary>Prepare · Import my games</summary>
        <label>
          Platform{" "}
          <select value={platform()} onChange={(event) => setPlatform(event.currentTarget.value)}>
            <option value="lichess">Lichess</option>
            <option value="chesscom">Chess.com</option>
          </select>
        </label>
        <label>
          Username{" "}
          <input
            value={username()}
            onInput={(event) => {
              setUsername(event.currentTarget.value);
            }}
          />
        </label>
        <Show when={platform() === "chesscom"}>
          <label>
            Month{" "}
            <input
              type="month"
              value={month()}
              onInput={(event) => setMonth(event.currentTarget.value)}
            />
          </label>
        </Show>
        <button
          disabled={
            !username().trim() ||
            state("lichess_games").status === "running" ||
            state("chesscom_games").status === "running" ||
            state("batch_review").status === "running"
          }
          onClick={() => void importGames()}
        >
          Import and review games
        </button>
        <button
          disabled={!username().trim()}
          onClick={() => void run("repertoire_vs_history", { ...args(), platform: platform() })}
        >
          Compare with my history
        </button>
        <p>Fetches public games from the selected service. Does not replace your repertoire.</p>
        {results(["lichess_games", "chesscom_games", "batch_review", "repertoire_vs_history"])}
      </details>
    </section>
  );
}
