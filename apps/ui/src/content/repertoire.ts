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
