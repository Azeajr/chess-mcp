/**
 * WP-022 — the repertoire panel's fixed four-group taxonomy.
 *
 * The group titles and their member sections are a product decision, not a rendering detail, so
 * they live here as data. The panel renders whatever this module declares; adding a tool means
 * adding it here, and the taxonomy spec asserts this map against what actually mounts.
 *
 * Groups, in display order:
 *  1. Analyze — engine-backed reads of the current repertoire.
 *  2. Prepare — opponent- and structure-facing lookups.
 *  3. Generate — exports and the Strategic Fit handoff.
 *  4. Prepare and export — the scan stores that mutate or extend the tree.
 */
export const REPERTOIRE_GROUPS = [
  {
    title: "Analyze",
    sections: ["Prescribed-move audit", "Only moves & drills", "Structure search"],
  },
  {
    title: "Prepare",
    sections: ["Opponent preparation"],
  },
  {
    title: "Generate",
    sections: ["Annotated repertoire", "strategic-fit-transfer"],
  },
  {
    title: "Prepare and export",
    sections: ["Gaps", "Connect", "Shorten", "Extend here"],
  },
] as const;

export type RepertoireGroupTitle = (typeof REPERTOIRE_GROUPS)[number]["title"];

/** Every section label the panel must mount, flattened from the groups. */
export const REPERTOIRE_SECTION_LABELS: readonly string[] = REPERTOIRE_GROUPS.flatMap(
  (group) => group.sections,
);

/** The command-registry tools with the group whose summary hosts their control. */
export const REPERTOIRE_COMMAND_TOOLS = [
  { command: "audit_repertoire_moves", group: "Analyze" },
  { command: "find_only_moves", group: "Analyze" },
  { command: "find_structures", group: "Analyze" },
  { command: "prep_vs_opponent", group: "Prepare" },
  { command: "export_annotated_repertoire", group: "Generate" },
] as const;

/**
 * WP-029 AC-1/AC-2: the Gaps section's three distinct states.
 *
 * `No scan yet — or no gaps.` conflated a call to action with a success result: the user could not
 * tell whether the repertoire was clean or the scan had simply never run. These are three separate
 * messages, and AC-1 requires the first two to differ.
 */
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

/**
 * WP-029 AC-5/AC-6: the Shorten inspect panel's plain reading.
 *
 * The panel opened with `quality: take shortcut (eval)` followed by `evalΔ 0.15 · fit 0.51→0.55 ·
 * 0.30→0.40` — a row of raw metrics with no statement of what they mean. The verdict sentence now
 * leads, and every number stays available under a disclosure (AC-7: nothing is dropped).
 */
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

/**
 * WP-029 AC-6: a margin in centipawns, read plainly with the raw value kept as expert text.
 *
 * `margin 35cp` assumes the reader thinks in centipawns. The plain reading leads; the exact value
 * stays in the title so nothing is lost for a reader who wants it.
 */
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
