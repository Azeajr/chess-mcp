/**
 * WP-030 — human-readable cohort names.
 *
 * A cohort is identified everywhere in the model by `cohort_id` (`cohort:<16 hex>`), which is
 * stable, language-neutral, and meaningless to a reader. This module derives a *display* name from
 * evidence the report already carries, and nothing else: the module is pure, takes the report as
 * input, and never mutates it. Identifiers keep their exact values for chat retrieval, overrides,
 * resolutions, and training records — see the preserved-behavior contract in WP-030.
 *
 * Derivation rules, in order:
 *
 *  1. Group the cohort's findings by `opening_scope` and take the dominant scope.
 *  2. If the dominant scope covers at least half the cohort's findings, the name is that scope.
 *     Below half, a single opening name would misrepresent a mixed cohort, so it falls back to
 *     `Comparison group N`.
 *  3. Cohorts with no findings also fall back — there is no evidence to name them from.
 *  4. Names that collide after step 2 are disambiguated with a stable numeric suffix.
 *
 * Every name carries the cohort's line count so the label states its own weight.
 */
import type { StrategicCohort, StrategicFinding, StrategicFitReport } from "@chess-mcp/chess-tools";

/** Share of a cohort's findings the dominant opening must cover before it may name the cohort. */
export const DOMINANT_OPENING_COVERAGE_THRESHOLD = 0.5;

export interface StrategicFitCohortName {
  readonly cohort_id: string;
  /** Name without the count, e.g. `Sicilian Defense` or `Comparison group 2`. */
  readonly name: string;
  /** Name with its line count, e.g. `Sicilian Defense (7 lines)`. This is what surfaces render. */
  readonly label: string;
  /** Lines represented by the cohort — `route_ids`, which is what "line" means to a reader. */
  readonly lineCount: number;
  /** True when the name came from a dominant opening rather than the positional fallback. */
  readonly derivedFromOpening: boolean;
  /** Set when two cohorts resolved to the same opening name and needed disambiguation (AC-3). */
  readonly disambiguator: number | null;
}

const lineWord = (count: number) => (count === 1 ? "line" : "lines");

/** `Sicilian Defense (7 lines)` — the count is part of the label at every call site (AC-2). */
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

/**
 * The opening scope covering the most findings, and the share it covers. Ties break on the scope
 * name so the result does not depend on finding order — two runs of the same report must name a
 * cohort identically.
 */
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

/**
 * Derive a display name for every cohort in the report.
 *
 * Returned in report cohort order, so callers can zip it against `report.cohorts`.
 */
export function deriveCohortNames(
  report: Pick<StrategicFitReport, "cohorts" | "findings">,
): StrategicFitCohortName[] {
  const byCohort = findingsByCohort(report.findings);

  // Pass 1: pick each cohort's preferred name and remember which openings repeat.
  const provisional = report.cohorts.map((cohort: StrategicCohort, index: number) => {
    const findings = byCohort.get(cohort.cohort_id) ?? [];
    const dominant = dominantOpeningScope(findings);
    // Below the threshold a single opening name would misrepresent a mixed cohort.
    const named =
      dominant !== null && dominant.coverage >= DOMINANT_OPENING_COVERAGE_THRESHOLD
        ? dominant.scope
        : null;
    return {
      cohort_id: cohort.cohort_id,
      lineCount: cohort.route_ids.length,
      // The fallback is numbered by report position so it is stable across renders (AC-1).
      baseName: named ?? `Comparison group ${index + 1}`,
      derivedFromOpening: named !== null,
    };
  });

  const nameCounts = new Map<string, number>();
  for (const entry of provisional) {
    nameCounts.set(entry.baseName, (nameCounts.get(entry.baseName) ?? 0) + 1);
  }

  // Pass 2: number only the names that actually collide, in report order (AC-3).
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

/** Lookup keyed by `cohort_id`, for surfaces that hold an id and need its label. */
export function cohortNameIndex(
  report: Pick<StrategicFitReport, "cohorts" | "findings">,
): Map<string, StrategicFitCohortName> {
  return new Map(deriveCohortNames(report).map((entry) => [entry.cohort_id, entry]));
}
