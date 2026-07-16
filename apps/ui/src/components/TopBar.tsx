/**
 * TopBar: open/save PGN, white/black repertoire toggle, new game, unsaved indicator, settings.
 * File I/O lives in store/files (shared with the Cmd/Ctrl+S shortcut).
 */
import { Show, createSignal } from "solid-js";
import { actions, color, dirty, fileName } from "../store/game";
import { openFile, saveFile, clearHandle, reopenLast, storedFileName } from "../store/files";
import { setSettingsOpen } from "../store/ui";
import { evalEnabled, setEvalEnabled } from "../store/analysis";
import { analysisDepth, setAnalysisDepth, MIN_ANALYSIS_DEPTH, MAX_ANALYSIS_DEPTH } from "../store/engine-settings";

export default function TopBar() {
  const [showDeepNotice, setShowDeepNotice] = createSignal(false);
  const updateDepth = (depth: number) => {
    setAnalysisDepth(depth);
    if (depth >= MAX_ANALYSIS_DEPTH) setShowDeepNotice(true);
  };
  return (
    <div class="topbar">
      <span class="title">Chess Repertoire</span>
      <Show when={dirty()}>
        <span class="dirty">● unsaved</span>
      </Show>
      <Show when={fileName()}>
        <span class="moveno">{fileName()}</span>
      </Show>
      <button onClick={() => void openFile()}>Open PGN</button>
      <Show when={storedFileName()}>
        <button title="Re-open your last file" onClick={() => void reopenLast()}>
          Reopen {storedFileName()}
        </button>
      </Show>
      <button onClick={() => void saveFile()}>Save</button>
      <button
        onClick={() => {
          // Guard the one-click data-loss path: newGame replaces the tree and the autosave then
          // overwrites the IndexedDB copy — with no file saved, that copy is the only one.
          if (dirty() && !window.confirm("Discard unsaved changes and start a new repertoire?")) return;
          clearHandle();
          actions.newGame();
        }}
      >
        New
      </button>
      <select
        value={color()}
        onChange={(e) => actions.setColor(e.currentTarget.value as "white" | "black")}
      >
        <option value="white">White</option>
        <option value="black">Black</option>
      </select>
      <button
        title={evalEnabled() ? "Disable board engine eval" : "Enable board engine eval"}
        onClick={() => setEvalEnabled((v) => !v)}
      >
        Eval {evalEnabled() ? "On" : "Off"}
      </button>
      <label class="depth-control" title="Analysis depth for engine-backed position, game, and repertoire operations">
        <span>Depth</span>
        <input aria-label="Analysis depth slider" type="range" min={MIN_ANALYSIS_DEPTH} max={MAX_ANALYSIS_DEPTH}
          value={analysisDepth()} onInput={(e) => updateDepth(e.currentTarget.valueAsNumber)} />
        <input class="depth-number" aria-label="Analysis depth" type="number" min={MIN_ANALYSIS_DEPTH} max={MAX_ANALYSIS_DEPTH}
          value={analysisDepth()} onInput={(e) => updateDepth(e.currentTarget.valueAsNumber)}
          onWheel={(e) => {
            e.preventDefault();
            updateDepth(analysisDepth() + (e.deltaY < 0 ? 1 : -1));
          }} />
      </label>
      <button onClick={() => setSettingsOpen(true)}>Settings</button>
      <Show when={showDeepNotice()}>
        <div class="analysis-notice" role="status">
          <span><b>Maximum analysis depth enabled.</b> Every engine task will use depth 30 and may take several minutes.</span>
          <button aria-label="Dismiss deep analysis notice" onClick={() => setShowDeepNotice(false)}>Dismiss</button>
        </div>
      </Show>
    </div>
  );
}
