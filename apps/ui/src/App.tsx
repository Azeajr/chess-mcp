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
import DocumentCloseDialog from "./components/DocumentCloseDialog";
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
import {
  restoreStrategicFitTrainingPerformance,
  startStrategicFitTrainingPerformancePersistence,
  strategicFitTrainingPerformanceWarning,
} from "./store/strategic-fit-training";
import { mobileTab, strategicFitWorkspaceOpen } from "./store/ui";
import { dispatchShortcut, registerShortcut } from "./store/shortcuts";
import {
  resizeSide,
  resizeSideChat,
  effSideWidth,
  effChatWidth,
  persistLayout,
  boardSize,
  setBoardSize,
  persistBoard,
  resetBoard,
  resetLayout,
  MIN_PX,
  MAX_PX,
} from "./store/layout";

export default function App() {
  startAutosave();
  startStrategicFitMetadataPersistence();
  startStrategicFitTrainingPerformancePersistence();
  startStrategicFitLifecycle();

  onMount(() => {
    void (async () => {
      await restoreWorking();
      await restoreStrategicFitMetadata();
      await restoreStrategicFitTrainingPerformance();
      void restoreLastFile();
    })();
    const onKey = (e: KeyboardEvent) => {
      dispatchShortcut(e);
    };
    const disposeShortcuts = [
      registerShortcut({
        id: "document.save",
        key: "s",
        allowInTextFields: true,
        handler: () => {
          void saveFile();
        },
      }),
      registerShortcut({
        id: "position.back",
        key: "ArrowLeft",
        handler: () => {
          actions.back();
        },
      }),
      registerShortcut({
        id: "position.forward",
        key: "ArrowRight",
        handler: () => {
          actions.forward();
        },
      }),
      registerShortcut({
        id: "document.undo",
        key: "z",
        handler: () => {
          actions.undo();
        },
      }),
    ];
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      disposeShortcuts.forEach((dispose) => {
        dispose();
      });
    });
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
          {(warning) => (
            <div class="strategic-fit-metadata-warning" role="alert">
              {warning().message}
            </div>
          )}
        </Show>
        <Show when={strategicFitTrainingPerformanceWarning()}>
          {(warning) => (
            <div class="strategic-fit-metadata-warning" role="alert">
              {warning()}
            </div>
          )}
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
            label="Resize the chessboard"
            value={boardSize() || 320}
            min={160}
            max={900}
            onResize={(d) => {
              const base =
                boardSize() > 0
                  ? boardSize()
                  : (document.querySelector(".board-wrap")?.clientWidth ?? 320);
              setBoardSize(base + d);
            }}
            onEnd={persistBoard}
            onReset={resetBoard}
          />
          {/* Phone-only panel switcher; hidden above 720px. */}
          <MobileTabs />
          {/* board│side boundary: drag right shrinks side so the board grows — the divider follows
              the cursor (board is flex:1 and absorbs the slack). */}
          <Divider
            label="Resize the analysis panel"
            value={effSideWidth()}
            min={MIN_PX}
            max={MAX_PX}
            valueDirection={-1}
            onResize={(d) => {
              resizeSide(-d);
            }}
            onEnd={persistLayout}
            onReset={resetLayout}
          />
          <div class="side-panel" style={{ width: `${effSideWidth()}px` }}>
            <AnalysisPanel />
            <RepertoirePanel />
            <MoveTree />
          </div>
          {/* side│chat boundary: drag right grows side, shrinks chat — board stays put. */}
          <Divider
            label="Resize the analysis and chat panels"
            value={effSideWidth()}
            min={MIN_PX}
            max={MAX_PX}
            onResize={(d) => {
              resizeSideChat(d);
            }}
            onEnd={persistLayout}
            onReset={resetLayout}
          />
          <div class="chat-wrap" style={{ width: `${effChatWidth()}px` }}>
            <ChatPanel />
          </div>
        </div>
      </div>
      <SettingsDrawer />
      <PromotionModal />
      <ColorPickerModal />
      <DocumentCloseDialog />
      <Show when={strategicFitWorkspaceOpen()}>
        <StrategicFitWorkspace />
      </Show>
    </div>
  );
}
