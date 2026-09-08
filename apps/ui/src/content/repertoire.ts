export const GAPS_STATES = {
  idle: {
    title: "Scan for unanswered replies.",
    body: "No gap scan has run yet.",
  },
  clean: {
    title: "No gaps found.",
    body: "Every checked reply is answered.",
  },
  error: {
    title: "The gap scan could not finish",
    retry: "Run the scan again",
  },
} as const;

/*
  The scan stops after `MAX_POSITIONS` decision nodes and keeps only `LIMIT` gaps, and a real
  repertoire has far more decision nodes than that: a 62-leaf tree has 265, of which the scan
  checks 12. "No gaps found" under a tick therefore reads as a verdict on the repertoire when it is
  a verdict on 4% of it, so every terminal state says which part was checked. The sibling scans in
  this panel already carry a `scope-note`; this is the same idiom, with the real counts.
*/
export const GAPS_SCOPE = {
  note: (limit: number) => `Up to ${limit} positions · local engine`,
  checked: (scanned: number, available: number) =>
    available > scanned
      ? `Checked the first ${scanned} of ${available} positions; the rest were not scanned.`
      : `Checked all ${available} positions.`,
  truncated: (shown: number, found: number) =>
    `Showing the ${shown} most severe of ${found} gaps found.`,
} as const;

export const SHORTCUT_INSPECT = {
  verdict: (recommend: string, savedPlies: number) =>
    recommend === "transpose"
      ? `Take the shortcut. It reaches the same prep ${savedPlies} ${savedPlies === 1 ? "ply" : "plies"} sooner.`
      : "Keep the current line. The shortcut is not a clear improvement.",
  basisLabel: "Decided on",
  disagree: "The evaluation and the structural fit disagree about this line.",
  detailsSummary: "Show the numbers",
  fields: {
    evalDelta: "Evaluation change",
    fitStay: "Fit, current line",
    fitTranspose: "Fit, shortcut line",
    structureStay: "Structure, current line",
    structureTranspose: "Structure, shortcut line",
  },
  fitWeak: "Fit is weak — both branches resemble the repertoire about equally.",
  coverageSafe: "No new gaps. This shortcut is coverage-safe.",
  coverageGaps: (count: number) =>
    `Opens ${count} new ${count === 1 ? "gap" : "gaps"} that your repertoire does not answer.`,
  badges: {
    savings: "Most moves saved",
    eval: "Best evaluation",
    evalConfirmed: "Best evaluation, deep-confirmed",
  },
} as const;

export function marginReading(centipawns: number): { plain: string; exact: string } {
  const abs = Math.abs(centipawns);
  const plain =
    abs >= 150
      ? "decisive margin"
      : abs >= 50
        ? "clear margin"
        : abs >= 20
          ? "slight margin"
          : "negligible margin";
  return { plain, exact: `${centipawns}cp` };
}
