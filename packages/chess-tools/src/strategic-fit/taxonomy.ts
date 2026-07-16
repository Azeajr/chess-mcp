/**
 * Hierarchical opening taxonomy for Strategic Fit.
 *
 * Source opening names are kept verbatim for display and provenance. Their hierarchy is a
 * deterministic projection used for descriptive containers; later cohort logic must still apply
 * strategic and decision-scope evidence before treating any taxonomy node as actionable.
 */
import type { OpeningEntry, OpeningTable } from "../openings.js";
import type { RepertoireGraph } from "./graph.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
} from "./version.js";

export const OPENING_TAXONOMY_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.taxonomy;

export type OpeningTaxonomyLevel = "family" | "system" | "variation";
export type OpeningTaxonomyState = "classified" | "unknown";
export type OpeningTaxonomyProvenanceKind =
  | "exact-position"
  | "inherited-position"
  | "inherited-common-ancestor"
  | "ambiguous-inheritance"
  | "missing-table"
  | "no-match";

export interface OpeningEcoRange {
  readonly from: string;
  readonly to: string;
}

export interface OpeningTaxonomyNameParts {
  readonly family: string;
  readonly system: string | null;
  readonly variations: readonly string[];
}

export interface OpeningTaxonomyNode {
  readonly taxonomy_id: string;
  readonly level: OpeningTaxonomyLevel;
  readonly label: string;
  readonly path_labels: readonly string[];
  readonly eco_range: OpeningEcoRange;
}

export interface OpeningTaxonomyProvenance {
  readonly kind: OpeningTaxonomyProvenanceKind;
  readonly source_position_ids: readonly string[];
  readonly source_eco_codes: readonly string[];
  /** Exact labels from the supplied opening table, never reconstructed display names. */
  readonly exact_source_names: readonly string[];
  readonly explanation: string;
}

export interface OpeningTaxonomy {
  readonly analysis_version: string;
  readonly taxonomy_version: string;
  readonly state: OpeningTaxonomyState;
  readonly family: OpeningTaxonomyNode | null;
  readonly system: OpeningTaxonomyNode | null;
  /** The most specific variation node, if the source label has variation levels. */
  readonly variation: OpeningTaxonomyNode | null;
  /** Every variation level, preserving comma- and colon-delimited source hierarchy. */
  readonly variation_path: readonly OpeningTaxonomyNode[];
  readonly path: readonly OpeningTaxonomyNode[];
  /** Range of the most specific available taxonomy node. */
  readonly eco_range: OpeningEcoRange | null;
  readonly provenance: OpeningTaxonomyProvenance;
}

export interface PositionOpeningTaxonomy {
  readonly position_id: string;
  readonly taxonomy: OpeningTaxonomy;
}

export interface RouteOpeningTaxonomy {
  readonly route_id: string;
  readonly terminal_position_id: string;
  readonly taxonomy: OpeningTaxonomy;
}

export interface RepertoireOpeningTaxonomy {
  readonly analysis_version: string;
  readonly taxonomy_version: string;
  readonly graph_id: string;
  readonly positions: readonly PositionOpeningTaxonomy[];
  readonly routes: readonly RouteOpeningTaxonomy[];
}

interface TaxonomyNodeAccumulator {
  readonly level: OpeningTaxonomyLevel;
  readonly label: string;
  readonly pathLabels: readonly string[];
  readonly ecoCodes: Set<string>;
}

interface ExactTaxonomy {
  readonly path: readonly OpeningTaxonomyNode[];
  readonly entry: OpeningEntry;
}

interface InheritedCandidate extends ExactTaxonomy {
  readonly sourcePositionId: string;
}

const PATH_SEPARATOR = "\u001f";
const QUALIFIED_GAMBIT = /^(.*\bGambit)\s+(Accepted|Declined)$/i;
const ECO_CODE = /^[A-E][0-9]{2}$/;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function taxonomyId(level: OpeningTaxonomyLevel, pathLabels: readonly string[]): string {
  return `opening-${level}:${stableHash(pathLabels.join(PATH_SEPARATOR).toLocaleLowerCase("en-US"))}`;
}

function canonicalSegments(value: string): string[] {
  return value
    .split(/\s*(?::|,)\s*/u)
    .map((segment) => segment.trim().replace(/\s+/gu, " "))
    .filter((segment) => segment.length > 0);
}

/**
 * Parse a source opening label into all supported levels.
 *
 * Accepted/Declined gambit qualifiers are promoted to system level so, for example, Queen's
 * Gambit Accepted and Queen's Gambit Declined share a family without losing their exact labels.
 */
export function classifyOpeningName(name: string): OpeningTaxonomyNameParts | null {
  const segments = canonicalSegments(name);
  const root = segments.shift();
  if (!root) return null;

  const qualifiedGambit = QUALIFIED_GAMBIT.exec(root);
  const family = qualifiedGambit?.[1]?.trim() ?? root;
  const rootSystem = qualifiedGambit?.[2] ?? null;
  const system = rootSystem ?? segments.shift() ?? null;

  return {
    family,
    system,
    variations: segments,
  };
}

function nodeSpecs(parts: OpeningTaxonomyNameParts): Array<{
  level: OpeningTaxonomyLevel;
  label: string;
  pathLabels: string[];
}> {
  const specs: Array<{ level: OpeningTaxonomyLevel; label: string; pathLabels: string[] }> = [];
  const pathLabels = [parts.family];
  specs.push({ level: "family", label: parts.family, pathLabels: [...pathLabels] });
  if (parts.system) {
    pathLabels.push(parts.system);
    specs.push({ level: "system", label: parts.system, pathLabels: [...pathLabels] });
  }
  for (const variation of parts.variations) {
    pathLabels.push(variation);
    specs.push({ level: "variation", label: variation, pathLabels: [...pathLabels] });
  }
  return specs;
}

function nodeKey(level: OpeningTaxonomyLevel, pathLabels: readonly string[]): string {
  return `${level}${PATH_SEPARATOR}${pathLabels.join(PATH_SEPARATOR)}`;
}

function normalizeEcoCode(code: string): string {
  return code.trim().toUpperCase();
}

function ecoRange(codes: ReadonlySet<string>): OpeningEcoRange {
  const sorted = [...codes].sort(compareStrings);
  return { from: sorted[0]!, to: sorted.at(-1)! };
}

function buildNodeCatalog(table: OpeningTable): Map<string, OpeningTaxonomyNode> {
  const accumulators = new Map<string, TaxonomyNodeAccumulator>();
  for (const entry of table.values()) {
    const parts = classifyOpeningName(entry.name);
    const eco = normalizeEcoCode(entry.eco);
    if (!parts || !ECO_CODE.test(eco)) continue;
    for (const spec of nodeSpecs(parts)) {
      const key = nodeKey(spec.level, spec.pathLabels);
      let accumulator = accumulators.get(key);
      if (!accumulator) {
        accumulator = {
          level: spec.level,
          label: spec.label,
          pathLabels: spec.pathLabels,
          ecoCodes: new Set(),
        };
        accumulators.set(key, accumulator);
      }
      accumulator.ecoCodes.add(eco);
    }
  }

  return new Map(
    [...accumulators.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, value]) => [
        key,
        {
          taxonomy_id: taxonomyId(value.level, value.pathLabels),
          level: value.level,
          label: value.label,
          path_labels: [...value.pathLabels],
          eco_range: ecoRange(value.ecoCodes),
        },
      ]),
  );
}

function exactTaxonomy(
  entry: OpeningEntry,
  catalog: ReadonlyMap<string, OpeningTaxonomyNode>,
): ExactTaxonomy | null {
  const parts = classifyOpeningName(entry.name);
  if (!parts) return null;
  const path = nodeSpecs(parts).map((spec) => catalog.get(nodeKey(spec.level, spec.pathLabels))).filter(
    (node): node is OpeningTaxonomyNode => node !== undefined,
  );
  return path.length > 0 ? { path, entry } : null;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function provenance(
  kind: OpeningTaxonomyProvenanceKind,
  candidates: readonly InheritedCandidate[],
  explanation: string,
): OpeningTaxonomyProvenance {
  return {
    kind,
    source_position_ids: sortedUnique(candidates.map((candidate) => candidate.sourcePositionId)),
    source_eco_codes: sortedUnique(candidates.map((candidate) => normalizeEcoCode(candidate.entry.eco))),
    exact_source_names: sortedUnique(candidates.map((candidate) => candidate.entry.name)),
    explanation,
  };
}

function taxonomyFromPath(
  path: readonly OpeningTaxonomyNode[],
  source: OpeningTaxonomyProvenance,
): OpeningTaxonomy {
  const family = path.find((node) => node.level === "family") ?? null;
  const system = path.find((node) => node.level === "system") ?? null;
  const variationPath = path.filter((node) => node.level === "variation");
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    taxonomy_version: OPENING_TAXONOMY_VERSION,
    state: "classified",
    family,
    system,
    variation: variationPath.at(-1) ?? null,
    variation_path: variationPath,
    path: [...path],
    eco_range: path.at(-1)?.eco_range ?? null,
    provenance: source,
  };
}

function unknownTaxonomy(
  kind: Extract<OpeningTaxonomyProvenanceKind, "ambiguous-inheritance" | "missing-table" | "no-match">,
  candidates: readonly InheritedCandidate[],
): OpeningTaxonomy {
  const explanation =
    kind === "missing-table"
      ? "No opening-classification table was supplied."
      : kind === "ambiguous-inheritance"
        ? "Incoming move orders inherit incompatible opening labels, so no deterministic taxonomy is assigned."
        : "No exact or inherited opening-classification match is available.";
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    taxonomy_version: OPENING_TAXONOMY_VERSION,
    state: "unknown",
    family: null,
    system: null,
    variation: null,
    variation_path: [],
    path: [],
    eco_range: null,
    provenance: provenance(kind, candidates, explanation),
  };
}

function commonPath(candidates: readonly InheritedCandidate[]): OpeningTaxonomyNode[] {
  if (candidates.length === 0) return [];
  const first = candidates[0]!.path;
  const common: OpeningTaxonomyNode[] = [];
  for (let index = 0; index < first.length; index++) {
    const expected = first[index]!;
    if (!candidates.every((candidate) => candidate.path[index]?.taxonomy_id === expected.taxonomy_id)) break;
    common.push(expected);
  }
  return common;
}

function inheritedTaxonomy(candidates: readonly InheritedCandidate[]): OpeningTaxonomy {
  if (candidates.length === 0) return unknownTaxonomy("no-match", []);
  const common = commonPath(candidates);
  if (common.length === 0) return unknownTaxonomy("ambiguous-inheritance", candidates);

  const distinctPaths = new Set(candidates.map((candidate) => candidate.path.map((node) => node.taxonomy_id).join(PATH_SEPARATOR)));
  const kind = distinctPaths.size === 1 ? "inherited-position" : "inherited-common-ancestor";
  const explanation =
    kind === "inherited-position"
      ? "No exact hit exists at this position; the deepest matching route ancestor supplies the label."
      : "Incoming move orders have different detailed labels; their deterministic common taxonomy ancestor is used.";
  return taxonomyFromPath(common, provenance(kind, candidates, explanation));
}

/**
 * Classify every canonical graph position and semantic route from the supplied opening table.
 * Exact canonical-position hits always win; otherwise labels are inherited only where all incoming
 * evidence has a deterministic common taxonomy ancestor.
 */
export function buildOpeningTaxonomy(
  graph: RepertoireGraph,
  table: OpeningTable | null | undefined,
): RepertoireOpeningTaxonomy {
  const tableAvailable = table !== null && table !== undefined && table.size > 0;
  if (!tableAvailable) {
    const positions = graph.positions.map((position) => ({
      position_id: position.position_id,
      taxonomy: unknownTaxonomy("missing-table", []),
    }));
    const positionById = new Map(positions.map((position) => [position.position_id, position.taxonomy]));
    return {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      taxonomy_version: OPENING_TAXONOMY_VERSION,
      graph_id: graph.graph_id,
      positions,
      routes: graph.routes.map((route) => ({
        route_id: route.route_id,
        terminal_position_id: route.terminal_position_id,
        taxonomy: positionById.get(route.terminal_position_id)!,
      })),
    };
  }

  const catalog = buildNodeCatalog(table);
  const exactByPosition = new Map<string, ExactTaxonomy>();
  for (const position of graph.positions) {
    const entry = table.get(position.position_key);
    if (!entry) continue;
    const exact = exactTaxonomy(entry, catalog);
    if (exact) exactByPosition.set(position.position_id, exact);
  }

  const inheritedByPosition = new Map<string, InheritedCandidate[]>();
  for (const route of graph.routes) {
    let lastExact: InheritedCandidate | null = null;
    for (const positionId of route.position_ids) {
      const exact = exactByPosition.get(positionId);
      if (exact) lastExact = { ...exact, sourcePositionId: positionId };
      if (!lastExact || exact) continue;
      const candidates = inheritedByPosition.get(positionId) ?? [];
      candidates.push(lastExact);
      inheritedByPosition.set(positionId, candidates);
    }
  }

  const positions = graph.positions.map((position): PositionOpeningTaxonomy => {
    const exact = exactByPosition.get(position.position_id);
    if (exact) {
      const candidate: InheritedCandidate = { ...exact, sourcePositionId: position.position_id };
      return {
        position_id: position.position_id,
        taxonomy: taxonomyFromPath(
          exact.path,
          provenance("exact-position", [candidate], "The canonical position has an exact opening-table hit."),
        ),
      };
    }
    return {
      position_id: position.position_id,
      taxonomy: inheritedTaxonomy(inheritedByPosition.get(position.position_id) ?? []),
    };
  });
  const positionById = new Map(positions.map((position) => [position.position_id, position.taxonomy]));

  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    taxonomy_version: OPENING_TAXONOMY_VERSION,
    graph_id: graph.graph_id,
    positions,
    routes: graph.routes.map((route) => ({
      route_id: route.route_id,
      terminal_position_id: route.terminal_position_id,
      taxonomy: positionById.get(route.terminal_position_id)!,
    })),
  };
}
