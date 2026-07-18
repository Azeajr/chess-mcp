import assert from "node:assert/strict";
import test from "node:test";

import { actions, color, currentPath, documentId, version } from "../src/store/game.ts";
import { commandStates } from "../src/store/commands.ts";
import {
  setStrategicFitWorkspaceOpen,
  setStrategicFitWorkspaceRegionState,
  setStrategicFitWorkspaceStage,
  strategicFitWorkspaceOpen,
  strategicFitWorkspaceRegions,
  strategicFitWorkspaceStage,
  type StrategicFitWorkspaceStage,
} from "../src/store/ui.ts";

const REGIONS: readonly StrategicFitWorkspaceStage[] = ["overview", "findings", "evidence", "resolution"];

function resetWorkspaceChrome() {
  setStrategicFitWorkspaceOpen(false);
  setStrategicFitWorkspaceStage("overview");
  for (const region of REGIONS) setStrategicFitWorkspaceRegionState(region, { status: "empty" });
}

test("Strategic Fit workspace chrome defaults to an honest empty overview", () => {
  resetWorkspaceChrome();
  assert.equal(strategicFitWorkspaceOpen(), false);
  assert.equal(strategicFitWorkspaceStage(), "overview");
  assert.deepEqual(strategicFitWorkspaceRegions(), {
    overview: { status: "empty" },
    findings: { status: "empty" },
    evidence: { status: "empty" },
    resolution: { status: "empty" },
  });
});

test("presentational loading and error states remain region-scoped", () => {
  resetWorkspaceChrome();
  setStrategicFitWorkspaceRegionState("overview", { status: "loading", message: "Loading fixture" });
  setStrategicFitWorkspaceRegionState("findings", { status: "error", message: "Error fixture" });

  assert.deepEqual(strategicFitWorkspaceRegions(), {
    overview: { status: "loading", message: "Loading fixture" },
    findings: { status: "error", message: "Error fixture" },
    evidence: { status: "empty" },
    resolution: { status: "empty" },
  });
  resetWorkspaceChrome();
});

test("opening and closing workspace chrome cannot change the working document or command state", () => {
  resetWorkspaceChrome();
  actions.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "workspace-fixture.pgn");
  actions.goto([0, 0, 0]);
  actions.setColor("black");
  const before = {
    pgn: actions.toPgn(),
    documentId: documentId(),
    revision: version(),
    path: [...currentPath()],
    color: color(),
    commands: structuredClone(commandStates()),
  };

  setStrategicFitWorkspaceOpen(true);
  setStrategicFitWorkspaceOpen(false);

  assert.deepEqual({
    pgn: actions.toPgn(),
    documentId: documentId(),
    revision: version(),
    path: [...currentPath()],
    color: color(),
    commands: structuredClone(commandStates()),
  }, before);
});
