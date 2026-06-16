/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { actions } from "./store/game";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
render(() => <App />, root);

// DEV-only handle for headless verification (loading a PGN otherwise needs the native file
// picker, which can't be driven in a headless browser). Not bundled in production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __chess?: typeof actions }).__chess = actions;
}
