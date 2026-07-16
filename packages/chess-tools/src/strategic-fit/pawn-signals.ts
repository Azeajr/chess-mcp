/**
 * Deterministic pawn-topology and center-dynamics observations for Strategic Fit.
 *
 * This layer describes positions; it does not judge whether a pawn feature is good or bad and it
 * does not claim that a single-position observation is persistent. Task 1.7 owns persistence over
 * route checkpoints. Approximate observations are explicitly named as candidates and retain their
 * classifier confidence and provenance.
 */
import { parseFen } from "chessops/fen";
import type { Board } from "chessops/board";
import { makeSquare, squareFile, squareRank } from "chessops/util";

import type { Color } from "../congruence.js";
import {
  centerState,
  classifyStructure,
  doubledPawns,
  isolatedPawns,
  passedPawns,
  pawnChains,
} from "../structure.js";
import type {
  SignalPersistenceState,
  StrategicFitSourceProvenance,
  StrategicSignal,
} from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
} from "./version.js";

const FILE_NAMES = "abcdefgh";
const CENTER_FILES = new Set([3, 4]);
const BROAD_CENTER_FILES = new Set([2, 3, 4, 5]);

export const PAWN_TOPOLOGY_FEATURE_IDS = [
  "pawn-topology.islands",
  "pawn-topology.connected-groups",
  "pawn-topology.backward-candidates",
  "pawn-topology.doubled-groups",
  "pawn-topology.isolated-pawns",
  "pawn-topology.passed-pawns",
  "pawn-topology.chains",
  "pawn-topology.wing-majority",
  "pawn-topology.named-formation",
] as const;
export type PawnTopologyFeatureId = (typeof PAWN_TOPOLOGY_FEATURE_IDS)[number];

export const CENTER_DYNAMICS_FEATURE_IDS = [
  "center-dynamics.openness",
  "center-dynamics.fixity",
  "center-dynamics.fluidity",
  "center-dynamics.tension",
  "center-dynamics.likely-breaks",
] as const;
export type CenterDynamicsFeatureId = (typeof CENTER_DYNAMICS_FEATURE_IDS)[number];
export type PawnSignalFeatureId = PawnTopologyFeatureId | CenterDynamicsFeatureId;

export type PawnSignalSubject = "repertoire" | "opponent";
export type PawnConstraintMobility = "mobile" | "static";

export interface PawnIsland {
  readonly files: readonly string[];
  readonly squares: readonly string[];
}

export interface PawnGroup {
  readonly squares: readonly string[];
  readonly mobility: PawnConstraintMobility;
}

export interface ConnectedPawnGroup {
  readonly squares: readonly string[];
  readonly connection: "phalanx" | "chain" | "mixed";
}

export interface BackwardPawnCandidate {
  readonly square: string;
  readonly advance_square: string;
  readonly advance_blocked: boolean;
  readonly advance_controlled_by_opponent_pawn: boolean;
}

export interface SubjectPawnObservation<T> {
  readonly subject: PawnSignalSubject;
  readonly color: Color;
  readonly observations: readonly T[];
}

export interface WingMajorityObservation {
  readonly subject: PawnSignalSubject;
  readonly color: Color;
  readonly wing: "queenside" | "kingside" | "none";
  readonly own_pawn_count: number;
  readonly opposing_pawn_count: number;
}

export const PAWN_FORMATION_IDS = [
  "iqp",
  "closed-sicilian",
  "hedgehog",
  "najdorf",
  "scheveningen",
  "hanging-pawns",
  "carlsbad",
  "maroczy",
  "french",
  "stonewall",
  "kings-indian",
  "benoni",
  "caro-kann",
  "slav",
  "grunfeld-centre",
  "nimzo-grunfeld",
  "symmetric-benoni",
  "lopez",
  "benko",
  "unknown",
] as const;
export type PawnFormationId = (typeof PAWN_FORMATION_IDS)[number];

export interface NamedPawnFormationObservation {
  /** Stable language-neutral identity; the legacy classifier label is evidence, not identity. */
  readonly formation_id: PawnFormationId;
  readonly classifier_label: string | null;
}

export type CenterOpenness = "open" | "semi-open" | "closed";
export interface CenterOpennessObservation {
  readonly state: CenterOpenness;
  readonly open_files: readonly string[];
  readonly semi_open_files: readonly string[];
  readonly asymmetrical: boolean;
}

export type CenterFixity = "unfixed" | "partially-fixed" | "fixed";
export interface FixedPawnPair {
  readonly white_pawn: string;
  readonly black_pawn: string;
}
export interface CenterFixityObservation {
  readonly state: CenterFixity;
  readonly fixed_pairs: readonly FixedPawnPair[];
}

export type CenterFluidity = "resolved" | "fixed" | "limited" | "fluid";
export interface CenterFluidityObservation {
  readonly state: CenterFluidity;
  readonly live_tension_count: number;
  readonly likely_break_count: number;
}

export interface CenterTensionPair {
  readonly repertoire_pawn: string;
  readonly opponent_pawn: string;
  readonly attacker: PawnSignalSubject | "both";
}

export interface LikelyPawnBreak {
  readonly subject: PawnSignalSubject;
  readonly color: Color;
  readonly from: string;
  readonly to: string;
  readonly challenges: readonly string[];
  readonly advance_length: 1 | 2;
  /** Geometric readiness only; this is not an engine or objective-quality claim. */
  readonly readiness: "geometrically-available";
  readonly confidence: number;
}

export interface PawnSignalValueMap {
  readonly "pawn-topology.islands": SubjectPawnObservation<PawnIsland>;
  readonly "pawn-topology.connected-groups": SubjectPawnObservation<ConnectedPawnGroup>;
  readonly "pawn-topology.backward-candidates": SubjectPawnObservation<BackwardPawnCandidate>;
  readonly "pawn-topology.doubled-groups": SubjectPawnObservation<PawnGroup>;
  readonly "pawn-topology.isolated-pawns": SubjectPawnObservation<PawnGroup>;
  readonly "pawn-topology.passed-pawns": SubjectPawnObservation<string>;
  readonly "pawn-topology.chains": SubjectPawnObservation<readonly string[]>;
  readonly "pawn-topology.wing-majority": WingMajorityObservation;
  readonly "pawn-topology.named-formation": NamedPawnFormationObservation;
  readonly "center-dynamics.openness": CenterOpennessObservation;
  readonly "center-dynamics.fixity": CenterFixityObservation;
  readonly "center-dynamics.fluidity": CenterFluidityObservation;
  readonly "center-dynamics.tension": { readonly pairs: readonly CenterTensionPair[] };
  readonly "center-dynamics.likely-breaks": { readonly breaks: readonly LikelyPawnBreak[] };
}

export type PawnStrategicSignal<F extends PawnSignalFeatureId = PawnSignalFeatureId> = Omit<
  StrategicSignal<PawnSignalValueMap[F]>,
  "family" | "feature_id"
> & {
  readonly family: F extends PawnTopologyFeatureId ? "pawn-topology" : "center-dynamics";
  readonly feature_id: F;
};

export interface PawnSignalReport {
  readonly analysis_version: string;
  readonly repertoire_color: Color;
  readonly signals: readonly PawnStrategicSignal[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

const CORE_PROVENANCE: readonly StrategicFitSourceProvenance[] = Object.freeze([
  Object.freeze({
    source_id: "strategic-fit:pawn-signals",
    kind: "deterministic-core",
    state: "available",
    version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components["pawn-signals"],
    snapshot: null,
    reason: null,
  }),
]);

const CLASSIFIER_PROVENANCE: readonly StrategicFitSourceProvenance[] = Object.freeze([
  ...CORE_PROVENANCE,
  Object.freeze({
    source_id: "chess-tools:structure-classifier",
    kind: "structure-classifier",
    state: "available",
    version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components["pawn-signals"],
    snapshot: null,
    reason: null,
  }),
]);

const FORMATION_IDS: Readonly<Record<string, PawnFormationId>> = Object.freeze({
  IQP: "iqp",
  "Closed Sicilian": "closed-sicilian",
  Hedgehog: "hedgehog",
  Najdorf: "najdorf",
  Scheveningen: "scheveningen",
  "Hanging pawns": "hanging-pawns",
  Carlsbad: "carlsbad",
  Maroczy: "maroczy",
  French: "french",
  Stonewall: "stonewall",
  "King's Indian": "kings-indian",
  Benoni: "benoni",
  "Caro-Kann": "caro-kann",
  Slav: "slav",
  "Grünfeld Centre": "grunfeld-centre",
  "Nimzo-Grünfeld": "nimzo-grunfeld",
  "Symmetric Benoni": "symmetric-benoni",
  Lopez: "lopez",
  Benko: "benko",
  unknown: "unknown",
});

function other(color: Color): Color {
  return color === "white" ? "black" : "white";
}

function subjectColor(repertoireColor: Color, subject: PawnSignalSubject): Color {
  return subject === "repertoire" ? repertoireColor : other(repertoireColor);
}

function pawnSquares(board: Board, color: Color): number[] {
  return [...board.pieces(color, "pawn")].sort((left, right) => left - right);
}

function squareNames(squares: readonly number[]): string[] {
  return squares.map(makeSquare).sort();
}

function forward(color: Color): 1 | -1 {
  return color === "white" ? 1 : -1;
}

function advanceSquare(square: number, color: Color, length = 1): number | null {
  const rank = squareRank(square) + forward(color) * length;
  return rank >= 0 && rank <= 7 ? squareFile(square) + rank * 8 : null;
}

function pawnCanAdvance(board: Board, square: number, color: Color): boolean {
  const to = advanceSquare(square, color);
  return to !== null && board.get(to) === undefined;
}

function pawnIslandsFor(board: Board, color: Color): PawnIsland[] {
  const byFile = new Map<number, number[]>();
  for (const square of pawnSquares(board, color)) {
    const file = squareFile(square);
    const values = byFile.get(file) ?? [];
    values.push(square);
    byFile.set(file, values);
  }
  const occupiedFiles = [...byFile.keys()].sort((left, right) => left - right);
  const islands: number[][] = [];
  for (const file of occupiedFiles) {
    const current = islands.at(-1);
    if (!current || file !== current.at(-1)! + 1) islands.push([file]);
    else current.push(file);
  }
  return islands.map((files) => ({
    files: files.map((file) => FILE_NAMES[file]!),
    squares: squareNames(files.flatMap((file) => byFile.get(file)!)),
  }));
}

function connectedPawnGroups(board: Board, color: Color): ConnectedPawnGroup[] {
  const squares = pawnSquares(board, color);
  const parents = new Map(squares.map((square) => [square, square]));
  const connections = new Map<string, "phalanx" | "chain">();
  const find = (square: number): number => {
    const parent = parents.get(square)!;
    if (parent === square) return square;
    const root = find(parent);
    parents.set(square, root);
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
  };

  for (let leftIndex = 0; leftIndex < squares.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < squares.length; rightIndex++) {
      const left = squares[leftIndex]!;
      const right = squares[rightIndex]!;
      if (Math.abs(squareFile(left) - squareFile(right)) !== 1) continue;
      const rankDistance = Math.abs(squareRank(left) - squareRank(right));
      if (rankDistance > 1) continue;
      const kind = rankDistance === 0 ? "phalanx" : "chain";
      connections.set(`${left}:${right}`, kind);
      union(left, right);
    }
  }

  const groups = new Map<number, number[]>();
  for (const square of squares) {
    const root = find(square);
    const group = groups.get(root) ?? [];
    group.push(square);
    groups.set(root, group);
  }
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group): ConnectedPawnGroup => {
      const members = new Set(group);
      const kinds = new Set(
        [...connections.entries()]
          .filter(([key]) => key.split(":").every((value) => members.has(Number(value))))
          .map(([, kind]) => kind),
      );
      return {
        squares: squareNames(group),
        connection: kinds.size > 1 ? "mixed" : kinds.has("phalanx") ? "phalanx" : "chain",
      };
    })
    .sort((left, right) => left.squares.join().localeCompare(right.squares.join()));
}

function opponentPawnControls(board: Board, square: number, color: Color): boolean {
  const enemy = other(color);
  const enemyDirection = forward(enemy);
  const sourceRank = squareRank(square) - enemyDirection;
  if (sourceRank < 0 || sourceRank > 7) return false;
  return [squareFile(square) - 1, squareFile(square) + 1].some((file) => {
    if (file < 0 || file > 7) return false;
    const piece = board.get(file + sourceRank * 8);
    return piece?.color === enemy && piece.role === "pawn";
  });
}

function backwardPawnCandidates(board: Board, color: Color): BackwardPawnCandidate[] {
  const squares = pawnSquares(board, color);
  return squares.flatMap((square) => {
    const adjacent = squares.filter(
      (candidate) => Math.abs(squareFile(candidate) - squareFile(square)) === 1,
    );
    if (!adjacent.length || adjacent.some((candidate) => squareRank(candidate) === squareRank(square))) {
      return [];
    }
    const advance = advanceSquare(square, color);
    if (advance === null) return [];
    const blocked = board.get(advance) !== undefined;
    const controlled = opponentPawnControls(board, advance, color);
    if (!blocked && !controlled) return [];
    return [{
      square: makeSquare(square),
      advance_square: makeSquare(advance),
      advance_blocked: blocked,
      advance_controlled_by_opponent_pawn: controlled,
    }];
  });
}

function groupedByFile(board: Board, color: Color, names: readonly string[]): PawnGroup[] {
  const wanted = new Set(names);
  const groups = new Map<number, number[]>();
  for (const square of pawnSquares(board, color)) {
    if (!wanted.has(makeSquare(square))) continue;
    const file = squareFile(square);
    const group = groups.get(file) ?? [];
    group.push(square);
    groups.set(file, group);
  }
  return [...groups.values()]
    .map((group): PawnGroup => ({
      squares: squareNames(group),
      mobility: group.some((square) => pawnCanAdvance(board, square, color)) ? "mobile" : "static",
    }))
    .sort((left, right) => left.squares.join().localeCompare(right.squares.join()));
}

function individualPawnGroups(board: Board, color: Color, names: readonly string[]): PawnGroup[] {
  return names.map((name) => {
    const square = pawnSquares(board, color).find((candidate) => makeSquare(candidate) === name)!;
    return {
      squares: [name],
      mobility: pawnCanAdvance(board, square, color) ? "mobile" : "static",
    };
  });
}

function wingMajorityFor(board: Board, repertoireColor: Color, subject: PawnSignalSubject): WingMajorityObservation {
  const color = subjectColor(repertoireColor, subject);
  const enemy = other(color);
  const count = (target: Color, minFile: number, maxFile: number): number =>
    pawnSquares(board, target).filter((square) => {
      const file = squareFile(square);
      return file >= minFile && file <= maxFile;
    }).length;
  const ownQueen = count(color, 0, 3);
  const enemyQueen = count(enemy, 0, 3);
  const ownKing = count(color, 4, 7);
  const enemyKing = count(enemy, 4, 7);
  const wing = ownQueen > enemyQueen && ownKing <= enemyKing
    ? "queenside"
    : ownKing > enemyKing && ownQueen <= enemyQueen
      ? "kingside"
      : "none";
  const queenside = wing === "queenside";
  return {
    subject,
    color,
    wing,
    own_pawn_count: wing === "none" ? pawnSquares(board, color).length : queenside ? ownQueen : ownKing,
    opposing_pawn_count: wing === "none" ? pawnSquares(board, enemy).length : queenside ? enemyQueen : enemyKing,
  };
}

function fixedPawnPairs(board: Board): FixedPawnPair[] {
  const black = new Set(pawnSquares(board, "black"));
  return pawnSquares(board, "white")
    .flatMap((whitePawn) => {
      if (!BROAD_CENTER_FILES.has(squareFile(whitePawn))) return [];
      const blackPawn = whitePawn + 8;
      return black.has(blackPawn)
        ? [{ white_pawn: makeSquare(whitePawn), black_pawn: makeSquare(blackPawn) }]
        : [];
    })
    .sort((left, right) => left.white_pawn.localeCompare(right.white_pawn));
}

function centerTensionPairs(board: Board, repertoireColor: Color): CenterTensionPair[] {
  const white = pawnSquares(board, "white");
  const black = new Set(pawnSquares(board, "black"));
  const pairs = new Map<string, { white: number; black: number; whiteAttacks: boolean; blackAttacks: boolean }>();
  const consider = (whitePawn: number, blackPawn: number, attacker: "white" | "black"): void => {
    if (![squareFile(whitePawn), squareFile(blackPawn)].some((file) => BROAD_CENTER_FILES.has(file))) return;
    const key = `${whitePawn}:${blackPawn}`;
    const current = pairs.get(key) ?? { white: whitePawn, black: blackPawn, whiteAttacks: false, blackAttacks: false };
    if (attacker === "white") current.whiteAttacks = true;
    else current.blackAttacks = true;
    pairs.set(key, current);
  };
  for (const whitePawn of white) {
    const rank = squareRank(whitePawn) + 1;
    if (rank > 7) continue;
    for (const file of [squareFile(whitePawn) - 1, squareFile(whitePawn) + 1]) {
      if (file < 0 || file > 7) continue;
      const blackPawn = file + rank * 8;
      if (black.has(blackPawn)) consider(whitePawn, blackPawn, "white");
    }
  }
  const whiteSet = new Set(white);
  for (const blackPawn of black) {
    const rank = squareRank(blackPawn) - 1;
    if (rank < 0) continue;
    for (const file of [squareFile(blackPawn) - 1, squareFile(blackPawn) + 1]) {
      if (file < 0 || file > 7) continue;
      const whitePawn = file + rank * 8;
      if (whiteSet.has(whitePawn)) consider(whitePawn, blackPawn, "black");
    }
  }
  return [...pairs.values()]
    .map((pair) => {
      const whiteSubject = repertoireColor === "white" ? "repertoire" : "opponent";
      const blackSubject = repertoireColor === "black" ? "repertoire" : "opponent";
      return {
        repertoire_pawn: makeSquare(repertoireColor === "white" ? pair.white : pair.black),
        opponent_pawn: makeSquare(repertoireColor === "white" ? pair.black : pair.white),
        attacker: pair.whiteAttacks && pair.blackAttacks
          ? "both"
          : pair.whiteAttacks
            ? whiteSubject
            : blackSubject,
      } as CenterTensionPair;
    })
    .sort((left, right) =>
      `${left.repertoire_pawn}:${left.opponent_pawn}`.localeCompare(
        `${right.repertoire_pawn}:${right.opponent_pawn}`,
      ),
    );
}

function likelyPawnBreaks(board: Board, repertoireColor: Color): LikelyPawnBreak[] {
  const result: LikelyPawnBreak[] = [];
  for (const color of ["white", "black"] as const) {
    const subject: PawnSignalSubject = color === repertoireColor ? "repertoire" : "opponent";
    const enemyPawns = new Set(pawnSquares(board, other(color)));
    for (const from of pawnSquares(board, color)) {
      const fromRank = squareRank(from);
      const lengths: readonly (1 | 2)[] =
        (color === "white" && fromRank === 1) || (color === "black" && fromRank === 6)
          ? [1, 2]
          : [1];
      for (const length of lengths) {
        const to = advanceSquare(from, color, length);
        if (to === null || board.get(to) !== undefined) continue;
        if (length === 2) {
          const intermediate = advanceSquare(from, color);
          if (intermediate === null || board.get(intermediate) !== undefined) continue;
        }
        const attackRank = squareRank(to) + forward(color);
        if (attackRank < 0 || attackRank > 7) continue;
        const challenges = [squareFile(to) - 1, squareFile(to) + 1]
          .filter((file) => file >= 0 && file <= 7)
          .map((file) => file + attackRank * 8)
          .filter((square) => enemyPawns.has(square))
          .filter((square) =>
            BROAD_CENTER_FILES.has(squareFile(square)) || BROAD_CENTER_FILES.has(squareFile(to)),
          );
        if (!challenges.length) continue;
        result.push({
          subject,
          color,
          from: makeSquare(from),
          to: makeSquare(to),
          challenges: squareNames(challenges),
          advance_length: length,
          readiness: "geometrically-available",
          confidence: length === 1 ? 0.75 : 0.7,
        });
      }
    }
  }
  return result.sort((left, right) =>
    `${left.subject}:${left.from}:${left.to}`.localeCompare(`${right.subject}:${right.from}:${right.to}`),
  );
}

function centerOpenness(board: Board): CenterOpennessObservation {
  const whiteFiles = new Set(pawnSquares(board, "white").map(squareFile));
  const blackFiles = new Set(pawnSquares(board, "black").map(squareFile));
  const openFiles = [...CENTER_FILES]
    .filter((file) => !whiteFiles.has(file) && !blackFiles.has(file))
    .map((file) => FILE_NAMES[file]!);
  const semiOpenFiles = [...CENTER_FILES]
    .filter((file) => whiteFiles.has(file) !== blackFiles.has(file))
    .map((file) => FILE_NAMES[file]!);
  const state: CenterOpenness = openFiles.length === 2
    ? "open"
    : openFiles.length > 0 || semiOpenFiles.length > 0
      ? "semi-open"
      : "closed";
  const whitePattern = [...CENTER_FILES].map((file) => whiteFiles.has(file));
  const blackPattern = [...CENTER_FILES].map((file) => blackFiles.has(file));
  return {
    state,
    open_files: openFiles,
    semi_open_files: semiOpenFiles,
    asymmetrical: whitePattern.some((value, index) => value !== blackPattern[index]),
  };
}

function makeSignal<F extends PawnSignalFeatureId>(
  featureId: F,
  value: PawnSignalValueMap[F],
  confidence: number,
  provenance: readonly StrategicFitSourceProvenance[] = CORE_PROVENANCE,
  persistence: SignalPersistenceState = "unknown",
  identitySuffix: string | null = null,
): PawnStrategicSignal<F> {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    signal_id: `signal:${featureId}${identitySuffix === null ? "" : `:${identitySuffix}`}`,
    family: featureId.startsWith("pawn-topology.") ? "pawn-topology" : "center-dynamics",
    feature_id: featureId,
    kind: "observation",
    value,
    confidence,
    persistence,
    provenance,
  } as PawnStrategicSignal<F>;
}

function subjectSignals(board: Board, repertoireColor: Color, subject: PawnSignalSubject): PawnStrategicSignal[] {
  const color = subjectColor(repertoireColor, subject);
  const doubled = doubledPawns(board, color);
  const isolated = isolatedPawns(board, color);
  return [
    makeSignal("pawn-topology.islands", {
      subject,
      color,
      observations: pawnIslandsFor(board, color),
    }, 1, CORE_PROVENANCE, "unknown", subject),
    makeSignal("pawn-topology.connected-groups", {
      subject,
      color,
      observations: connectedPawnGroups(board, color),
    }, 1, CORE_PROVENANCE, "unknown", subject),
    makeSignal("pawn-topology.backward-candidates", {
      subject,
      color,
      observations: backwardPawnCandidates(board, color),
    }, 0.7, CORE_PROVENANCE, "unknown", subject),
    makeSignal("pawn-topology.doubled-groups", {
      subject,
      color,
      observations: groupedByFile(board, color, doubled),
    }, 1, CORE_PROVENANCE, "unknown", subject),
    makeSignal("pawn-topology.isolated-pawns", {
      subject,
      color,
      observations: individualPawnGroups(board, color, isolated),
    }, 1, CORE_PROVENANCE, "unknown", subject),
    makeSignal("pawn-topology.passed-pawns", {
      subject,
      color,
      observations: passedPawns(board, color),
    }, 1, CORE_PROVENANCE, "unknown", subject),
    makeSignal("pawn-topology.chains", {
      subject,
      color,
      observations: pawnChains(board, color),
    }, 1, CORE_PROVENANCE, "unknown", subject),
    makeSignal(
      "pawn-topology.wing-majority",
      wingMajorityFor(board, repertoireColor, subject),
      1,
      CORE_PROVENANCE,
      "unknown",
      subject,
    ),
  ];
}

/** Extract deterministic, engine-free pawn and center observations from one legal position. */
export function extractPawnSignals(board: Board, repertoireColor: Color): PawnSignalReport {
  const classification = classifyStructure(board);
  const tension = centerTensionPairs(board, repertoireColor);
  const fixedPairs = fixedPawnPairs(board);
  const breaks = likelyPawnBreaks(board, repertoireColor);
  const openness = centerOpenness(board);
  const legacyCenter = centerState(board);
  const fixity: CenterFixity = fixedPairs.length >= 2 || legacyCenter === "locked"
    ? "fixed"
    : fixedPairs.length === 1
      ? "partially-fixed"
      : "unfixed";
  const centralPawnCount = [...board.pieces("white", "pawn"), ...board.pieces("black", "pawn")]
    .filter((square) => CENTER_FILES.has(squareFile(square))).length;
  const fluidity: CenterFluidity = openness.state === "open" && centralPawnCount <= 1
    ? "resolved"
    : tension.length > 0 || breaks.length >= 2
      ? "fluid"
      : fixity !== "unfixed" && breaks.length === 0
        ? "fixed"
        : "limited";
  const formationId = FORMATION_IDS[classification.structure_class] ?? "unknown";

  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    repertoire_color: repertoireColor,
    signals: [
      ...subjectSignals(board, repertoireColor, "repertoire"),
      ...subjectSignals(board, repertoireColor, "opponent"),
      makeSignal("pawn-topology.named-formation", {
        formation_id: formationId,
        classifier_label: formationId === "unknown" ? null : classification.structure_class,
      }, classification.confidence, CLASSIFIER_PROVENANCE),
      makeSignal("center-dynamics.openness", openness, 0.95),
      makeSignal("center-dynamics.fixity", { state: fixity, fixed_pairs: fixedPairs }, 1),
      makeSignal("center-dynamics.fluidity", {
        state: fluidity,
        live_tension_count: tension.length,
        likely_break_count: breaks.length,
      }, 0.75),
      makeSignal("center-dynamics.tension", { pairs: tension }, 1),
      makeSignal("center-dynamics.likely-breaks", { breaks }, 0.7),
    ],
    provenance: CLASSIFIER_PROVENANCE,
  };
}

/** Convenience boundary for callers that do not otherwise need a chessops board. */
export function extractPawnSignalsFromFen(fen: string, repertoireColor: Color): PawnSignalReport {
  return extractPawnSignals(parseFen(fen).unwrap().board, repertoireColor);
}
