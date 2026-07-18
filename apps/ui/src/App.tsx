import { onMount, onCleanup, Show } from "solid-js";
import TopBar from "./components/TopBar";
import Board from "./components/Board";
import EvalBar from "./components/EvalBar";
import MoveTree from "./components/MoveTree";
import AnalysisPanel from "./components/AnalysisPanel";
import RepertoirePanel from "./components/RepertoirePanel";
import ChatPanel from "./components/ChatPanel";
import Divider from "./components/Divider";
import MobileTabs from "./components/MobileTabs";
import SettingsDrawer from "./components/SettingsDrawer";
import PromotionModal from "./components/PromotionModal";
import ColorPickerModal from "./components/ColorPickerModal";
import StrategicFitWorkspace from "./components/StrategicFitWorkspace";
import { actions } from "./store/game";
import { saveFile, restoreLastFile } from "./store/files";
import { startAutosave, restoreWorking } from "./store/persist";
import {
  restoreStrategicFitMetadata,
  startStrategicFitMetadataPersistence,
  strategicFitMetadataWarning,
} from "./store/strategic-fit-metadata";
import { startStrategicFitLifecycle } from "./store/strategic-fit";
import { mobileTab, strategicFitWorkspaceOpen } from "./store/ui";
import { resizeSide, resizeSideChat, effSideWidth, effChatWidth, persistLayout, boardSize, setBoardSize, persistBoard } from "./store/layout";

export default function App() {
  startAutosave();
  startStrategicFitMetadataPersistence();
  startStrategicFitLifecycle();

  onMount(() => {
    void (async () => {
      await restoreWorking();
      await restoreStrategicFitMetadata();
      void restoreLastFile();
    })();
    const onKey = (e: KeyboardEvent) => {
      if (strategicFitWorkspaceOpen()) return;
      // Cmd/Ctrl+S saves even from a text field (nothing else claims it). Everything below must NOT
      // fire while typing: Ctrl+Z especially — undo() deletes a leaf node, so hijacking the text-edit
      // undo would silently mutate the repertoire.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveFile();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        actions.undo();
        return;
      }
      if (e.key === "ArrowLeft") actions.back();
      else if (e.key === "ArrowRight") actions.forward();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="app">
      <div
        class="app-main"
        inert={strategicFitWorkspaceOpen()}
        aria-hidden={strategicFitWorkspaceOpen() ? "true" : undefined}
      >
        <TopBar />
        <Show when={strategicFitMetadataWarning()}>
          {(warning) => <div class="strategic-fit-metadata-warning" role="alert">{warning().message}</div>}
        </Show>
        <div
          class="workspace"
          data-mtab={mobileTab()}
          style={boardSize() ? { "--board-size": `${boardSize()}px` } : undefined}
        >
          <div class="board-panel">
            <EvalBar />
            <Board />
          </div>
          {/* Phone-only: drag to resize the pinned board (hidden above 720px). Seed from the
              rendered square on the first drag so it picks up where the CSS default left off. */}
          <Divider
            axis="y"
            onResize={(d) => {
              const base = boardSize() || (document.querySelector(".board-wrap") as HTMLElement | null)?.clientWidth || 320;
              setBoardSize(base + d);
            }}
            onEnd={persistBoard}
          />
          {/* Phone-only panel switcher; hidden above 720px. */}
          <MobileTabs />
          {/* board│side boundary: drag right shrinks side so the board grows — the divider follows
              the cursor (board is flex:1 and absorbs the slack). */}
          <Divider onResize={(d) => resizeSide(-d)} onEnd={persistLayout} />
          <div class="side-panel" style={{ width: `${effSideWidth()}px` }}>
            <AnalysisPanel />
            <RepertoirePanel />
            <MoveTree />
          </div>
          {/* side│chat boundary: drag right grows side, shrinks chat — board stays put. */}
          <Divider onResize={(d) => resizeSideChat(d)} onEnd={persistLayout} />
          <div class="chat-wrap" style={{ width: `${effChatWidth()}px` }}>
            <ChatPanel />
          </div>
        </div>
        <SettingsDrawer />
        <PromotionModal />
        <ColorPickerModal />
      </div>
      <Show when={strategicFitWorkspaceOpen()}><StrategicFitWorkspace /></Show>
    </div>
  );
}
