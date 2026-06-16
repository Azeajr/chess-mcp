import { onMount, onCleanup } from "solid-js";
import TopBar from "./components/TopBar";
import Board from "./components/Board";
import EvalBar from "./components/EvalBar";
import MoveTree from "./components/MoveTree";
import AnalysisPanel from "./components/AnalysisPanel";
import GapsPanel from "./components/GapsPanel";
import ChatPanel from "./components/ChatPanel";
import SettingsDrawer from "./components/SettingsDrawer";
import PromotionModal from "./components/PromotionModal";
import { actions } from "./store/game";
import { saveFile, restoreLastFile } from "./store/files";
import { startAutosave, restoreWorking } from "./store/persist";

export default function App() {
  startAutosave();

  onMount(() => {
    void (async () => {
      await restoreWorking();
      void restoreLastFile();
    })();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveFile();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        actions.undo();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowLeft") actions.back();
      else if (e.key === "ArrowRight") actions.forward();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="app">
      <TopBar />
      <div class="workspace">
        <div class="board-panel">
          <EvalBar />
          <Board />
        </div>
        <div class="side-panel">
          <AnalysisPanel />
          <GapsPanel />
          <MoveTree />
        </div>
        <ChatPanel />
      </div>
      <SettingsDrawer />
      <PromotionModal />
    </div>
  );
}
