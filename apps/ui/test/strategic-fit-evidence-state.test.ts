import assert from "node:assert/strict";
import test from "node:test";
import type { StrategicFitPreflight } from "@chess-mcp/chess-tools";
import {
  comparablePlyThresholdFromPreflight,
  evidenceStateFromPreflight,
} from "../src/store/strategic-fit.ts";
import { lifecycleLabel } from "../src/components/strategic-fit/AnalysisLifecycle.tsx";
import { STRATEGIC_FIT_EVIDENCE } from "../src/content/strategicFit.ts";

function preflight(
  state: StrategicFitPreflight["state"],
  comparable: number,
  threshold: number | null = null,
): StrategicFitPreflight {
  return {
    analysis_version: "2.0.0",
    state,
    route_count: 3,
    comparable_route_count: comparable,
    incomplete_route_count: 3 - comparable,
    issues:
      threshold === null
        ? []
        : [
            {
              analysis_version: "2.0.0",
              issue_id: "preflight:shallow-route",
              code: "shallow-route",
              kind: "evidence-limitation",
              severity: "degraded",
              message: `Routes ending before ply ${threshold} have incomplete strategic evidence.`,
              affected_route_ids: [],
              affected_source_paths: [],
              details: { first_comparable_ply: threshold },
              provenance: [],
            },
          ],
  };
}

test("WP-031 evidence state uses comparable-route count before the broad preflight state", () => {
  assert.equal(evidenceStateFromPreflight(preflight("degraded", 0)), "none");
  assert.equal(evidenceStateFromPreflight(preflight("degraded", 2)), "limited");
  assert.equal(evidenceStateFromPreflight(preflight("ready", 3)), "full");
});

test("WP-031 the completed label reflects limited evidence but full evidence remains complete", () => {
  assert.equal(lifecycleLabel("completed", "none"), "Analysis finished — limited evidence");
  assert.equal(lifecycleLabel("completed", "limited"), "Analysis finished — limited evidence");
  assert.equal(lifecycleLabel("completed", "full"), "Analysis complete");
  assert.equal(lifecycleLabel("running", null), "Analysis starting");
});

test("WP-031 terminal copy states the threshold and counts carried by the payload", () => {
  const payload = preflight("degraded", 0, 12);
  const threshold = comparablePlyThresholdFromPreflight(payload);
  assert.equal(threshold, 12);

  const copy = STRATEGIC_FIT_EVIDENCE.noneBody(
    payload.route_count,
    payload.comparable_route_count,
    threshold,
  );
  assert.match(copy, /3 routes/);
  assert.match(copy, /0 of them/);
  assert.match(copy, /ply 12/);
  assert.ok(STRATEGIC_FIT_EVIDENCE.noneRemedies.length >= 2);
});

test("WP-031 terminal copy remains honest when no issue supplies a threshold", () => {
  const payload = preflight("degraded", 0);
  assert.equal(comparablePlyThresholdFromPreflight(payload), null);
  assert.doesNotMatch(
    STRATEGIC_FIT_EVIDENCE.noneBody(payload.route_count, payload.comparable_route_count, null),
    /ply \d+/,
  );
});
