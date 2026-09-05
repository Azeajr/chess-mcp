import type { StrategicFinding, StrategicFitClassification, StrategicFitReport } from "./types.js";

export const STRATEGIC_FIT_ANNOTATION_STATUS = Object.freeze({
  "genuine-inconsistency": "reviewable-observation",
  "forced-diversity": "opponent-forced-exception",
  "intentional-diversity": "intentional-exception",
  "productive-diversity": "productive-diversity",
  "mixed-strategic-profile": "supported-multiple-modes",
  uncertain: "uncertain-evidence-only",
  "data-quality-issue": "data-quality-limitation",
  "transpositional-equivalence": "equivalent-move-orders",
} satisfies Readonly<Record<StrategicFitClassification, string>>);

export interface StrategicFitPortableAnnotation {
  readonly finding_id: string;
  readonly source_san_paths: readonly (readonly string[])[];
  readonly text: string;
}

function annotationStatus(finding: StrategicFinding): string {
  if (finding.resolution_state === "keep-intentionally") return "intentional-exception";
  if (finding.resolution_state === "insufficient-evidence") return "uncertain-evidence-only";
  return STRATEGIC_FIT_ANNOTATION_STATUS[finding.classification];
}

function uniquePaths(paths: readonly (readonly string[])[]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const path of paths) {
    const key = JSON.stringify(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([...path]);
  }
  return result;
}

export function strategicFitAnnotationText(finding: StrategicFinding): string {
  const status = annotationStatus(finding);
  const confidence = `${finding.confidence.label} (${finding.confidence.score}/100)`;
  const difference = `${finding.difference.magnitude} (${finding.difference.distance.toFixed(3)})`;
  return (
    `Strategic Fit evidence [analysis=${finding.analysis_version}; ` +
    `finding=${finding.finding_id}; category=${finding.classification}; ` +
    `confidence=${confidence}; difference=${difference}; ` +
    `cohort=${finding.evidence.cohort_id}; status=${status}]: ` +
    `${finding.plain_language_category} — ${finding.explanation}`
  );
}

export function strategicFitPortableAnnotations(
  report: StrategicFitReport,
): StrategicFitPortableAnnotation[] {
  return report.findings.flatMap((finding) => {
    const sourceSanPaths = uniquePaths(finding.references.source_san_paths);
    return sourceSanPaths.length === 0
      ? []
      : [
          {
            finding_id: finding.finding_id,
            source_san_paths: sourceSanPaths,
            text: strategicFitAnnotationText(finding),
          },
        ];
  });
}
