import { createSignal } from "solid-js";
import { preference } from "./preferences";

// Form drafts that both the visible controls and the browser assistant edit. Each control used to
// own its value through a component-local signal, so nothing outside the component could fill or
// read it. One shared signal per field keeps the draft the user sees and the draft a guided step
// submits identical. `formVersion` changes on every edit so a stale assistant action is refused.

export type HistoryPlatform = "lichess" | "chesscom";
export type ExtendStyle = "low_memorization" | "sharp";

const [formVersion, setFormVersion] = createSignal(0);
export { formVersion };
const bump = () => setFormVersion((value) => value + 1);

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const [historyPlatform, setHistoryPlatformValue] = createSignal<HistoryPlatform>("lichess");
const [historyUsername, setHistoryUsernameValue] = preference("chess.import.username", "");
const [historyMonth, setHistoryMonthValue] = createSignal(currentMonth());
const [structureQuery, setStructureQueryValue] = preference("chess.structure", "");
const [opponentUsername, setOpponentUsernameValue] = preference("chess.opponent", "");
const [opponentHistory, setOpponentHistory] = preference("chess.opponents", "");
const [storedExtendStyle, setExtendStyleValue] = preference(
  "chess.extend.style",
  "low_memorization",
);

export { historyPlatform, historyUsername, historyMonth, structureQuery, opponentUsername };
export { opponentHistory };
export const extendStyle = (): ExtendStyle =>
  storedExtendStyle() === "sharp" ? "sharp" : "low_memorization";

export function setHistoryPlatform(value: HistoryPlatform) {
  setHistoryPlatformValue(value);
  bump();
}
export function setHistoryUsername(value: string) {
  setHistoryUsernameValue(value);
  bump();
}
export function setHistoryMonth(value: string) {
  setHistoryMonthValue(value);
  bump();
}
export function setStructureQuery(value: string) {
  setStructureQueryValue(value);
  bump();
}
export function setOpponentUsername(value: string) {
  setOpponentUsernameValue(value);
  bump();
}
export function setExtendStyle(value: ExtendStyle) {
  setExtendStyleValue(value);
  bump();
}

/** Remembers a prepared opponent for the datalist; not a draft, so it does not bump the version. */
export function rememberOpponent(username: string) {
  if (!username) return;
  setOpponentHistory(
    [...new Set([username, ...opponentHistory().split("\n").filter(Boolean)])]
      .slice(0, 5)
      .join("\n"),
  );
}

/** Provider arguments for the account-history form, exactly as the visible form submits them. */
export function historyArguments() {
  const [year, month] = historyMonth().split("-");
  return {
    username: historyUsername().trim(),
    ...(historyPlatform() === "chesscom"
      ? { year: Number(year), month: Number(month) }
      : { max_games: 20 }),
  };
}
