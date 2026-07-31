/**
 * Deterministic half of AI plan synthesis for a retained exception.
 *
 * When a finding is kept and trained rather than replaced, the assistant may write the plan card
 * that goes with it: what the plan is, which break or exchange matters, what the danger signs are,
 * and which position to drill. That narrative is the one part of the training record no tool can
 * produce, and it is also the part a model can invent. This module owns the boundary that must not
 * depend on a host: every section has to name deterministic evidence that already exists, and every
 * move the prose mentions has to come from a validated repertoire path.
 *
 * Validation rejects rather than repairs, for the same reason as the intent interview: a sentence
 * the user typed has a witness, a sentence the model produced does not. An unsupported concept,
 * checkpoint, drill, move, or external game citation fails with a structured code instead of being
 * quietly dropped from otherwise-plausible prose.
 *
 * This module never writes, persists, or decides what "accept" means. Persistence stays with the
 * existing Task 6.3 training writer.
 */

export const STRATEGIC_FIT_PLAN_CARD_VERSION = "1.0.0";

/** Fixed bounds for a model-authored plan card. Exceeding one is an error, never a truncation. */
export const STRATEGIC_FIT_PLAN_LIMITS = Object.freeze({
  sections: 8,
  title_characters: 120,
  section_text_characters: 600,
  section_anchors: 8,
  /** Bounds of the evidence basis disclosed to the model; anything withheld cannot be cited. */
  evidence_concept_ids: 32,
  evidence_checkpoints: 16,
  evidence_drills: 16,
  evidence_san_paths: 3,
  evidence_san_path_plies: 24,
  evidence_moves: 64,
});

/**
 * The section kinds the design names for a retained exception. Each is a claim about the position,
 * so each must rest on evidence: a concept the classifier emitted, a checkpoint the trajectory
 * reached, or a drill built from a legal repertoire decision.
 */
export const STRATEGIC_FIT_PLAN_SECTION_KINDS = [
  "strategic-plan",
  "pawn-break",
  "favorable-exchange",
  "danger-sign",
  "familiar-structure-comparison",
  "model-position",
] as const;
export type StrategicFitPlanSectionKind = (typeof STRATEGIC_FIT_PLAN_SECTION_KINDS)[number];

export const STRATEGIC_FIT_PLAN_ERROR_CODES = [
  "strategic_fit_plan_empty",
  "strategic_fit_plan_invalid_section",
  "strategic_fit_plan_invalid_value",
  "strategic_fit_plan_missing_support",
  "strategic_fit_plan_unsupported_concept",
  "strategic_fit_plan_unsupported_checkpoint",
  "strategic_fit_plan_unsupported_drill",
  "strategic_fit_plan_unsupported_move",
  "strategic_fit_plan_unsupported_model_game",
  "strategic_fit_plan_evidence_unavailable",
  "strategic_fit_plan_stale",
  "strategic_fit_plan_not_pending",
] as const;
export type StrategicFitPlanErrorCode = (typeof STRATEGIC_FIT_PLAN_ERROR_CODES)[number];

export class StrategicFitPlanError extends Error {
  readonly code: StrategicFitPlanErrorCode;
  constructor(code: StrategicFitPlanErrorCode, message: string) {
    super(message);
    this.name = "StrategicFitPlanError";
    this.code = code;
  }
}

export interface StrategicFitPlanErrorResult {
  readonly error: StrategicFitPlanErrorCode;
  readonly reason: string;
}

/** Shared host mapping from a validation failure to one structured, code-bearing result. */
export function strategicFitPlanErrorResult(error: unknown): StrategicFitPlanErrorResult {
  if (error instanceof StrategicFitPlanError) return { error: error.code, reason: error.message };
  throw error;
}

export interface StrategicFitPlanCheckpointEvidence {
  readonly checkpoint_id: string;
  readonly kind: string;
  readonly ply: number;
  readonly comparability: string;
}

export interface StrategicFitPlanDrillEvidence {
  readonly drill_id: string;
  readonly expected_san: string;
  readonly source: string;
  readonly checkpoint_id: string | null;
}

/**
 * Everything a plan card is allowed to rest on, already bounded. The host derives it from the
 * deterministic training record for one finding; the same object is disclosed to the model and used
 * to validate what comes back, so evidence withheld from the disclosure cannot be cited either.
 */
export interface StrategicFitPlanEvidence {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly repertoire_revision: string;
  readonly training_id: string;
  readonly concept_ids: readonly string[];
  readonly omitted_concept_count: number;
  readonly checkpoints: readonly StrategicFitPlanCheckpointEvidence[];
  readonly omitted_checkpoint_count: number;
  readonly drills: readonly StrategicFitPlanDrillEvidence[];
  readonly omitted_drill_count: number;
  readonly causal_move_san: string | null;
  readonly san_paths: readonly (readonly string[])[];
  readonly omitted_san_path_count: number;
  /** Every SAN the prose may mention, taken from the paths, drills, and causal move above. */
  readonly moves: readonly string[];
  readonly omitted_move_count: number;
}

export interface StrategicFitPlanSectionInput {
  readonly kind?: unknown;
  readonly text?: unknown;
  readonly concept_ids?: unknown;
  readonly checkpoint_ids?: unknown;
  readonly drill_ids?: unknown;
}

export interface StrategicFitPlanCardInput {
  readonly title?: unknown;
  readonly sections?: unknown;
}

export interface StrategicFitPlanSection {
  readonly kind: StrategicFitPlanSectionKind;
  readonly text: string;
  readonly concept_ids: readonly string[];
  readonly checkpoint_ids: readonly string[];
  readonly drill_ids: readonly string[];
  /** SAN the text mentions. Every entry was resolved against the evidence move vocabulary. */
  readonly cited_moves: readonly string[];
}

export interface StrategicFitPlanCard {
  readonly plan_card_version: typeof STRATEGIC_FIT_PLAN_CARD_VERSION;
  readonly title: string;
  readonly sections: readonly StrategicFitPlanSection[];
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly training_id: string;
  /** Identity of the exact evidence the card was validated against; a change voids the card. */
  readonly evidence_identity: string;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values.filter((value) => value.length > 0))].sort(compareStrings);

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Stable identity of one evidence basis. Acceptance recomputes the basis from current canonical
 * evidence and compares this value, so a re-analysis that moved a checkpoint, dropped a concept, or
 * changed a drill invalidates a card the user is still looking at.
 */
export function strategicFitPlanEvidenceIdentity(evidence: StrategicFitPlanEvidence): string {
  return `strategic-fit-plan-evidence:${stableHash(JSON.stringify({
    report_id: evidence.report_id,
    finding_id: evidence.finding_id,
    semantic_finding_id: evidence.semantic_finding_id,
    repertoire_revision: evidence.repertoire_revision,
    training_id: evidence.training_id,
    concept_ids: [...evidence.concept_ids].sort(compareStrings),
    checkpoint_ids: evidence.checkpoints.map((entry) => entry.checkpoint_id).sort(compareStrings),
    drills: [...evidence.drills]
      .map((entry) => `${entry.drill_id}${entry.expected_san}`)
      .sort(compareStrings),
    causal_move_san: evidence.causal_move_san,
    moves: [...evidence.moves].sort(compareStrings),
  }))}`;
}

const SAN_PATTERN =
  /^(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)$/;
/**
 * A citation of an external game. Deterministic Strategic Fit evidence never contains a calendar
 * year or a hyphenated pair of surnames, so either one means the model reached outside the evidence
 * for a model game — the exact claim it may not make without a game result to stand on.
 */
const GAME_YEAR_PATTERN = /\b(?:1[5-9]\d{2}|20\d{2})\b/;
const GAME_PAIRING_PATTERN = /\b[A-Z][a-z]+\s*[–—-]\s*[A-Z][a-z]+\b/;

/** Split prose into candidate SAN tokens; move numbers, punctuation, and glyphs fall away. */
export function strategicFitPlanMoveMentions(text: string): string[] {
  const mentions: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9=+#-]+/)) {
    const token = raw.replace(/[+#]+$/, "");
    if (token.length === 0) continue;
    if (SAN_PATTERN.test(token) && !mentions.includes(token)) mentions.push(token);
  }
  return mentions;
}

function invalidValue(field: string, requirement: string): never {
  throw new StrategicFitPlanError(
    "strategic_fit_plan_invalid_value",
    `${field} ${requirement}. Write the card within the documented bounds; values are never trimmed to fit.`,
  );
}

function anchorList(
  field: string,
  value: unknown,
  allowed: ReadonlySet<string>,
  code: StrategicFitPlanErrorCode,
  hint: string,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalidValue(field, "must be an array of identities the evidence returned");
  if (value.length > STRATEGIC_FIT_PLAN_LIMITS.section_anchors) {
    invalidValue(field, `must contain at most ${STRATEGIC_FIT_PLAN_LIMITS.section_anchors} identities`);
  }
  const resolved: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !allowed.has(entry)) {
      throw new StrategicFitPlanError(
        code,
        `${field} contains ${JSON.stringify(entry)}, which the deterministic evidence for this finding does not contain. ${hint}`,
      );
    }
    if (!resolved.includes(entry)) resolved.push(entry);
  }
  return resolved;
}

function section(
  input: unknown,
  index: number,
  evidence: StrategicFitPlanEvidence,
  concepts: ReadonlySet<string>,
  checkpoints: ReadonlySet<string>,
  drills: ReadonlySet<string>,
  moves: ReadonlySet<string>,
): StrategicFitPlanSection {
  const path = `sections[${index}]`;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_invalid_section",
      `${path} must be an object with a kind, text, and the evidence it rests on.`,
    );
  }
  const candidate = input as StrategicFitPlanSectionInput;
  const allowedKeys = new Set(["kind", "text", "concept_ids", "checkpoint_ids", "drill_ids"]);
  const unknownKey = Object.keys(candidate).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_invalid_section",
      `${path}.${unknownKey} is not part of a plan section. Valid fields: ${[...allowedKeys].join(", ")}.`,
    );
  }
  if (
    typeof candidate.kind !== "string" ||
    !(STRATEGIC_FIT_PLAN_SECTION_KINDS as readonly string[]).includes(candidate.kind)
  ) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_invalid_section",
      `${path}.kind must be one of: ${STRATEGIC_FIT_PLAN_SECTION_KINDS.join(", ")}.`,
    );
  }
  const kind = candidate.kind as StrategicFitPlanSectionKind;
  if (typeof candidate.text !== "string") invalidValue(`${path}.text`, "must be a string");
  const text = candidate.text.trim();
  if (text.length === 0) invalidValue(`${path}.text`, "must not be blank");
  if (text.length > STRATEGIC_FIT_PLAN_LIMITS.section_text_characters) {
    invalidValue(
      `${path}.text`,
      `must be at most ${STRATEGIC_FIT_PLAN_LIMITS.section_text_characters} characters`,
    );
  }
  if (GAME_YEAR_PATTERN.test(text) || GAME_PAIRING_PATTERN.test(text)) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_unsupported_model_game",
      `${path}.text cites an outside game. This operation can verify only the finding's own evidence, so a master game or its moves needs its own result from a game or population operation and cannot be saved into a plan card.`,
    );
  }
  const conceptIds = anchorList(
    `${path}.concept_ids`,
    candidate.concept_ids,
    concepts,
    "strategic_fit_plan_unsupported_concept",
    `Cite one of the concepts the analysis reported for this finding: ${evidence.concept_ids.join(", ") || "none were reported"}.`,
  );
  const checkpointIds = anchorList(
    `${path}.checkpoint_ids`,
    candidate.checkpoint_ids,
    checkpoints,
    "strategic_fit_plan_unsupported_checkpoint",
    "Cite a checkpoint identity from the evidence basis for this finding.",
  );
  const drillIds = anchorList(
    `${path}.drill_ids`,
    candidate.drill_ids,
    drills,
    "strategic_fit_plan_unsupported_drill",
    "Cite a drill identity from the evidence basis for this finding.",
  );
  if (conceptIds.length + checkpointIds.length + drillIds.length === 0) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_missing_support",
      `${path} names no evidence. Every section must cite at least one concept, checkpoint, or drill from this finding; an observation with nothing behind it is exactly what must not be saved.`,
    );
  }
  if (kind === "model-position" && drillIds.length === 0) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_unsupported_model_game",
      `${path} is a model position but cites no drill. A position to play through must be one of the finding's legal drill positions; this operation cannot introduce a position of its own.`,
    );
  }
  const citedMoves: string[] = [];
  for (const mention of strategicFitPlanMoveMentions(text)) {
    if (!moves.has(mention)) {
      throw new StrategicFitPlanError(
        "strategic_fit_plan_unsupported_move",
        `${path}.text mentions ${mention}, which is not a move on any validated path for this finding. Playable moves here are: ${evidence.moves.join(", ") || "none were returned"}. A move outside them needs its own legality result and cannot be saved into a plan card.`,
      );
    }
    citedMoves.push(mention);
  }
  return {
    kind,
    text,
    concept_ids: conceptIds,
    checkpoint_ids: checkpointIds,
    drill_ids: drillIds,
    cited_moves: citedMoves,
  };
}

/**
 * Validate a model-authored plan card against one deterministic evidence basis. It does not save,
 * merge, or persist anything; a resolved card is still only a proposal until the host commits it
 * through the existing training writer.
 */
export function resolveStrategicFitPlanCard(
  input: StrategicFitPlanCardInput,
  evidence: StrategicFitPlanEvidence,
): StrategicFitPlanCard {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalidValue("plan", "must be an object with a title and sections");
  }
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_empty",
      "A plan card must contain at least one section. Ask the user what they want to practise rather than saving an empty card.",
    );
  }
  if (input.sections.length > STRATEGIC_FIT_PLAN_LIMITS.sections) {
    invalidValue("plan.sections", `must contain at most ${STRATEGIC_FIT_PLAN_LIMITS.sections} sections`);
  }
  if (typeof input.title !== "string") invalidValue("plan.title", "must be a string");
  const title = input.title.trim();
  if (title.length === 0) invalidValue("plan.title", "must not be blank");
  if (title.length > STRATEGIC_FIT_PLAN_LIMITS.title_characters) {
    invalidValue("plan.title", `must be at most ${STRATEGIC_FIT_PLAN_LIMITS.title_characters} characters`);
  }
  if (GAME_YEAR_PATTERN.test(title) || GAME_PAIRING_PATTERN.test(title)) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_unsupported_model_game",
      "plan.title cites an outside game. Name the plan after what the branch asks the player to do, not after a game this operation cannot verify.",
    );
  }
  const concepts = new Set(evidence.concept_ids);
  const checkpoints = new Set(evidence.checkpoints.map((entry) => entry.checkpoint_id));
  const drills = new Set(evidence.drills.map((entry) => entry.drill_id));
  const moves = new Set(evidence.moves);
  if (concepts.size + checkpoints.size + drills.size === 0) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_evidence_unavailable",
      "This finding has no concepts, checkpoints, or drills to build a plan on. Say the evidence is unavailable rather than describing the branch from chess knowledge.",
    );
  }
  const sections = input.sections.map((entry, index) =>
    section(entry, index, evidence, concepts, checkpoints, drills, moves));
  const titleMention = strategicFitPlanMoveMentions(title).find((mention) => !moves.has(mention));
  if (titleMention !== undefined) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_unsupported_move",
      `plan.title mentions ${titleMention}, which is not a move on any validated path for this finding.`,
    );
  }
  return {
    plan_card_version: STRATEGIC_FIT_PLAN_CARD_VERSION,
    title,
    sections,
    report_id: evidence.report_id,
    finding_id: evidence.finding_id,
    semantic_finding_id: evidence.semantic_finding_id,
    training_id: evidence.training_id,
    evidence_identity: strategicFitPlanEvidenceIdentity(evidence),
  };
}

/**
 * Re-check an already resolved card against current evidence. The training writer calls this so no
 * path can persist a card whose support disappeared, including one handed to it directly rather
 * than through the staged proposal.
 */
export function assertStrategicFitPlanCardSupported(
  card: StrategicFitPlanCard,
  evidence: StrategicFitPlanEvidence,
): StrategicFitPlanCard {
  if (card.plan_card_version !== STRATEGIC_FIT_PLAN_CARD_VERSION) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_invalid_value",
      `Unsupported plan card version: ${String(card.plan_card_version)}.`,
    );
  }
  const resolved = resolveStrategicFitPlanCard(
    {
      title: card.title,
      sections: card.sections.map((entry) => ({
        kind: entry.kind,
        text: entry.text,
        concept_ids: entry.concept_ids,
        checkpoint_ids: entry.checkpoint_ids,
        drill_ids: entry.drill_ids,
      })),
    },
    evidence,
  );
  if (resolved.evidence_identity !== card.evidence_identity) {
    throw new StrategicFitPlanError(
      "strategic_fit_plan_stale",
      "The evidence behind this plan card changed after it was written; write it again against the current evidence so the user confirms what is actually supported.",
    );
  }
  return resolved;
}

const SECTION_LABELS: Readonly<Record<StrategicFitPlanSectionKind, string>> = {
  "strategic-plan": "Plan",
  "pawn-break": "Pawn break",
  "favorable-exchange": "Favorable exchange",
  "danger-sign": "Danger sign",
  "familiar-structure-comparison": "Familiar structure",
  "model-position": "Model position",
};

export const strategicFitPlanSectionLabel = (kind: StrategicFitPlanSectionKind): string =>
  SECTION_LABELS[kind];

/**
 * Durable text for the confirmed card. The training resolution note is plain text, so the rendered
 * form keeps the section labels and the evidence each section cited rather than flattening the card
 * into a paragraph whose support can no longer be traced.
 */
export function renderStrategicFitPlanCardText(card: StrategicFitPlanCard): string {
  return [
    card.title,
    ...card.sections.map((entry) => {
      const cited = sortedUnique([
        ...entry.concept_ids,
        ...entry.checkpoint_ids,
        ...entry.drill_ids,
      ]);
      return `${SECTION_LABELS[entry.kind]}: ${entry.text} [${cited.join(", ")}]`;
    }),
  ].join("\n");
}
