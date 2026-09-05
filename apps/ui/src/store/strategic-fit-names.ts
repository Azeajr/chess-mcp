import type { StrategicCohort, StrategicFinding, StrategicFitReport } from "@chess-mcp/chess-tools";

export const DOMINANT_OPENING_COVERAGE_THRESHOLD = 0.5;

export interface StrategicFitCohortName {
  readonly cohort_id: string;
  readonly name: string;
  readonly label: string;
  readonly lineCount: number;
  readonly derivedFromOpening: boolean;
  readonly disambiguator: number | null;
}

const lineWord = (count: number) => (count === 1 ? "line" : "lines");

export function formatCohortLabel(name: string, lineCount: number): string {
  return `${name} (${lineCount} ${lineWord(lineCount)})`;
}

function findingsByCohort(findings: readonly StrategicFinding[]): Map<string, StrategicFinding[]> {
  const byCohort = new Map<string, StrategicFinding[]>();
  for (const finding of findings) {
    const id = finding.evidence.cohort_id;
    const bucket = byCohort.get(id);
    if (bucket) bucket.push(finding);
    else byCohort.set(id, [finding]);
  }
  return byCohort;
}

function dominantOpeningScope(
  findings: readonly StrategicFinding[],
): { scope: string; coverage: number } | null {
  if (!findings.length) return null;
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const scope = finding.opening_scope.trim();
    if (!scope) continue;
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const ranked = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const top = ranked[0];
  if (!top) return null;
  return { scope: top[0], coverage: top[1] / findings.length };
}

export function deriveCohortNames(
  report: Pick<StrategicFitReport, "cohorts" | "findings">,
): StrategicFitCohortName[] {
  const byCohort = findingsByCohort(report.findings);

  const provisional = report.cohorts.map((cohort: StrategicCohort, index: number) => {
    const findings = byCohort.get(cohort.cohort_id) ?? [];
    const dominant = dominantOpeningScope(findings);
    const named =
      dominant !== null && dominant.coverage >= DOMINANT_OPENING_COVERAGE_THRESHOLD
        ? dominant.scope
        : null;
    return {
      cohort_id: cohort.cohort_id,
      lineCount: cohort.route_ids.length,
      baseName: named ?? `Comparison group ${index + 1}`,
      derivedFromOpening: named !== null,
    };
  });

  const nameCounts = new Map<string, number>();
  for (const entry of provisional) {
    nameCounts.set(entry.baseName, (nameCounts.get(entry.baseName) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return provisional.map((entry) => {
    const collides = (nameCounts.get(entry.baseName) ?? 0) > 1;
    const ordinal = (seen.get(entry.baseName) ?? 0) + 1;
    seen.set(entry.baseName, ordinal);
    const disambiguator = collides ? ordinal : null;
    const name = disambiguator === null ? entry.baseName : `${entry.baseName} ${disambiguator}`;
    return {
      cohort_id: entry.cohort_id,
      name,
      label: formatCohortLabel(name, entry.lineCount),
      lineCount: entry.lineCount,
      derivedFromOpening: entry.derivedFromOpening,
      disambiguator,
    };
  });
}

export function cohortNameIndex(
  report: Pick<StrategicFitReport, "cohorts" | "findings">,
): Map<string, StrategicFitCohortName> {
  return new Map(deriveCohortNames(report).map((entry) => [entry.cohort_id, entry]));
}
