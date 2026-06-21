import { onMount, onCleanup } from "solid-js";
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
import { actions } from "./store/game";
import { saveFile, restoreLastFile } from "./store/files";
import { startAutosave, restoreWorking } from "./store/persist";
import { mobileTab } from "./store/ui";
import { sideWidth, chatWidth, setSideWidth, setChatWidth, effSideWidth, effChatWidth, persistLayout } from "./store/layout";

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
      <div class="workspace" data-mtab={mobileTab()}>
        <div class="board-panel">
          <EvalBar />
          <Board />
        </div>
        {/* Phone-only panel switcher; hidden above 720px. */}
        <MobileTabs />
        <Divider onResize={(d) => setSideWidth(sideWidth() + d)} onEnd={persistLayout} />
        <div class="side-panel" style={{ width: `${effSideWidth()}px` }}>
          <AnalysisPanel />
          <RepertoirePanel />
          <MoveTree />
        </div>
        {/* dragging this divider right grows the side panel and steals from chat → negate */}
        <Divider onResize={(d) => setChatWidth(chatWidth() - d)} onEnd={persistLayout} />
        <div class="chat-wrap" style={{ width: `${effChatWidth()}px` }}>
          <ChatPanel />
        </div>
      </div>
      <SettingsDrawer />
      <PromotionModal />
      <ColorPickerModal />
    </div>
  );
}
