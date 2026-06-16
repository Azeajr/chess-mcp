import { onMount, onCleanup } from "solid-js";
import TopBar from "./components/TopBar";
import Board from "./components/Board";
import EvalBar from "./components/EvalBar";
import MoveTree from "./components/MoveTree";
import AnalysisPanel from "./components/AnalysisPanel";
import GapsPanel from "./components/GapsPanel";
import { actions } from "./store/game";

export default function App() {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
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
      </div>
    </div>
  );
}
