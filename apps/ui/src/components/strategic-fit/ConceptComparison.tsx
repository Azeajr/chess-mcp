import { For, Show } from "solid-js";
import type { JsonValue, StrategicFinding } from "@chess-mcp/chess-tools";

const formatPercent = (value: number): string => new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
}).format(value * 100) + "%";

const humanize = (value: string): string => {
  const words = value.replaceAll("_", "-").split("-").filter(Boolean).join(" ");
  return words.length === 0 ? "Unnamed dimension" : `${words[0]!.toUpperCase()}${words.slice(1)}`;
};

function readableJson(value: JsonValue): string {
  if (value === null) return "Unavailable";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(value);
  if (typeof value === "string") {
    return /^[a-z][a-z-]*$/.test(value) ? humanize(value) : value;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "None reported" : value.map(readableJson).join(", ");
  }
  const entries = Object.entries(value);
  return entries.length === 0
    ? "No structured values reported"
    : entries.map(([key, item]) => `${humanize(key)}: ${readableJson(item)}`).join("; ");
}

export interface StrategicFitDimensionPresentation {
  readonly dimension_id: string;
  readonly label: string;
  readonly typical: string;
  readonly affected: string;
  readonly typical_available: boolean;
  readonly affected_available: boolean;
  readonly contribution: number;
  readonly contribution_label: string;
  readonly explanation: string;
  readonly raw_typical: string;
  readonly raw_affected: string;
}

export interface StrategicFitContributionReconciliation {
  readonly state: "unavailable" | "reconciled" | "partial";
  readonly listed_total: number | null;
  readonly report_distance: number;
  readonly unlisted_difference: number | null;
  readonly summary: string;
}

export interface StrategicFitConceptComparisonPresentation {
  readonly dimensions: readonly StrategicFitDimensionPresentation[];
  readonly reconciliation: StrategicFitContributionReconciliation;
}

export function buildConceptComparisonPresentation(
  finding: StrategicFinding,
): StrategicFitConceptComparisonPresentation {
  const dimensions = finding.evidence.dimensions.map((dimension) => {
    const featureId = dimension.dimension_id.split(".").at(-1) ?? dimension.dimension_id;
    return {
      dimension_id: dimension.dimension_id,
      label: humanize(featureId),
      typical: readableJson(dimension.typical_value),
      affected: readableJson(dimension.affected_value),
      typical_available: dimension.typical_value !== null,
      affected_available: dimension.affected_value !== null,
      contribution: dimension.contribution,
      contribution_label: `${formatPercent(dimension.contribution)} of normalized strategic distance`,
      explanation: dimension.explanation,
      raw_typical: JSON.stringify(dimension.typical_value),
      raw_affected: JSON.stringify(dimension.affected_value),
    };
  });
  if (dimensions.length === 0) {
    return {
      dimensions,
      reconciliation: {
        state: "unavailable",
        listed_total: null,
        report_distance: finding.difference.distance,
        unlisted_difference: null,
        summary: "Contribution breakdown is unavailable because this finding has no comparable dimensions.",
      },
    };
  }
  const listedTotal = dimensions.reduce((sum, dimension) => sum + dimension.contribution, 0);
  const unlistedDifference = finding.difference.distance - listedTotal;
  const reconciled = Math.abs(unlistedDifference) <= 0.00001;
  return {
    dimensions,
    reconciliation: {
      state: reconciled ? "reconciled" : "partial",
      listed_total: listedTotal,
      report_distance: finding.difference.distance,
      unlisted_difference: reconciled ? 0 : unlistedDifference,
      summary: reconciled
        ? `Listed dimensions reconcile to the report's ${formatPercent(finding.difference.distance)} strategic distance.`
        : `Listed dimensions total ${formatPercent(listedTotal)}; the report distance is ${formatPercent(finding.difference.distance)}. The ${formatPercent(Math.abs(unlistedDifference))} gap is not assigned to the listed dimensions.`,
    },
  };
}

export default function ConceptComparison(props: { finding: StrategicFinding }) {
  const presentation = () => buildConceptComparisonPresentation(props.finding);
  return (
    <section class="strategic-fit-concept-comparison" aria-labelledby="strategic-fit-comparison-title">
      <h4 id="strategic-fit-comparison-title">Why this branch stands apart</h4>
      <Show when={presentation().dimensions.length > 0} fallback={(
        <p class="strategic-fit-evidence-unavailable">
          No typical-versus-branch dimensions are available for this finding.
        </p>
      )}>
        <div class="strategic-fit-comparison-table-wrap">
          <table>
            <caption class="sr-only">Typical cohort compared with the affected repertoire branch</caption>
            <thead>
              <tr>
                <th scope="col">Strategic dimension</th>
                <th scope="col">Typical cohort</th>
                <th scope="col">This branch</th>
              </tr>
            </thead>
            <tbody>
              <For each={presentation().dimensions}>{(dimension) => (
                <tr data-dimension-id={dimension.dimension_id}>
                  <th scope="row">
                    {dimension.label}
                    <span>{dimension.contribution_label}</span>
                  </th>
                  <td data-value-state={dimension.typical_available ? "available" : "unavailable"}>
                    {dimension.typical}
                  </td>
                  <td data-value-state={dimension.affected_available ? "available" : "unavailable"}>
                    {dimension.affected}
                  </td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </div>
      </Show>
      <p
        class="strategic-fit-contribution-reconciliation"
        data-reconciliation-state={presentation().reconciliation.state}
      >
        {presentation().reconciliation.summary}
      </p>
    </section>
  );
}
