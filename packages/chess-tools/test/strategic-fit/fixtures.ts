import { GameTree } from "../../src/index.ts";

export const STRATEGIC_FIT_FIXTURE_TAGS = [
  "white-repertoire",
  "black-repertoire",
  "transpositions",
  "unequal-line-depths",
  "broad-eco-families",
  "multimodal-structures",
  "shallow-lines",
  "intentional-annotations",
] as const;

export type StrategicFitFixtureTag = (typeof STRATEGIC_FIT_FIXTURE_TAGS)[number];
export type RepertoireColor = "white" | "black";

export interface StrategicFitFixture {
  readonly id: string;
  readonly description: string;
  readonly repertoireColor: RepertoireColor;
  readonly tags: readonly StrategicFitFixtureTag[];
  readonly pgn: string;
  readonly expected: {
    readonly nodes: number;
    readonly leaves: number;
    readonly maxDepth: number;
    readonly transpositionGroups: number;
  };
}

function fixture(value: StrategicFitFixture): StrategicFitFixture {
  return Object.freeze({
    ...value,
    tags: Object.freeze([...value.tags]),
    expected: Object.freeze({ ...value.expected }),
  });
}

export const WHITE_TRANSPOSITION_FIXTURE = fixture({
  id: "white-transpositions",
  description: "A White Queen's Gambit repertoire reaching the same position by two move orders.",
  repertoireColor: "white",
  tags: ["white-repertoire", "transpositions"],
  pgn: `[Event "Strategic Fit fixture: move order A"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 *

[Event "Strategic Fit fixture: move order B"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 *`,
  expected: { nodes: 16, leaves: 2, maxDepth: 8, transpositionGroups: 2 },
});

export const UNEQUAL_DEPTH_FIXTURE = fixture({
  id: "unequal-depths",
  description: "Queen's Gambit branches ending at deliberately different strategic horizons.",
  repertoireColor: "white",
  tags: ["white-repertoire", "unequal-line-depths"],
  pgn: `[Event "Strategic Fit fixture: deep QGD"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6 *

[Event "Strategic Fit fixture: medium QGD"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. d4 d5 2. c4 e6 3. Nc3 Bb4 4. cxd5 exd5 *

[Event "Strategic Fit fixture: shallow QGD"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. d4 d5 2. c4 e6 3. Nc3 c6 *`,
  expected: { nodes: 18, leaves: 3, maxDepth: 14, transpositionGroups: 0 },
});

export const BROAD_ECO_FIXTURE = fixture({
  id: "broad-eco-families",
  description: "White repertoire routes spanning open, semi-open, closed, and flank openings.",
  repertoireColor: "white",
  tags: ["white-repertoire", "broad-eco-families"],
  pgn: `[Event "Strategic Fit fixture: Ruy Lopez"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *

[Event "Strategic Fit fixture: Open Sicilian"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 *

[Event "Strategic Fit fixture: French"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. e4 e6 2. d4 d5 3. Nc3 Bb4 *

[Event "Strategic Fit fixture: Queen's Gambit"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 *

[Event "Strategic Fit fixture: English"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. c4 e5 2. Nc3 Nf6 3. g3 d5 *`,
  expected: { nodes: 30, leaves: 5, maxDepth: 8, transpositionGroups: 0 },
});

export const MULTIMODAL_STRUCTURE_FIXTURE = fixture({
  id: "multimodal-structures",
  description: "French branches with advance, exchange, and Tarrasch center structures.",
  repertoireColor: "white",
  tags: ["white-repertoire", "multimodal-structures"],
  pgn: `[Event "Strategic Fit fixture: French Advance"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 *

[Event "Strategic Fit fixture: French Exchange"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. e4 e6 2. d4 d5 3. exd5 exd5 4. Nf3 Nf6 5. Bd3 Bd6 *

[Event "Strategic Fit fixture: French Tarrasch"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. e4 e6 2. d4 d5 3. Nd2 c5 4. exd5 exd5 5. Ngf3 Nc6 *`,
  expected: { nodes: 22, leaves: 3, maxDepth: 10, transpositionGroups: 0 },
});

export const SHALLOW_LINES_FIXTURE = fixture({
  id: "shallow-lines",
  description: "Legal White routes that stop before comparable middlegame evidence is available.",
  repertoireColor: "white",
  tags: ["white-repertoire", "unequal-line-depths", "shallow-lines"],
  pgn: `[Event "Strategic Fit fixture: shallow king pawn"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. e4 e5 *

[Event "Strategic Fit fixture: shallow queen pawn"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. d4 d5 2. c4 *

[Event "Strategic Fit fixture: shallow flank"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. c4 *`,
  expected: { nodes: 6, leaves: 3, maxDepth: 3, transpositionGroups: 0 },
});

export const INTENTIONAL_ANNOTATIONS_FIXTURE = fixture({
  id: "intentional-annotations",
  description: "A Catalan setup carrying ordinary PGN comments that express deliberate intent.",
  repertoireColor: "white",
  tags: ["white-repertoire", "intentional-annotations"],
  pgn: `[Event "Strategic Fit fixture: intentional Catalan"]
[Result "*"]
[ChesstempoRepertoireColour "White"]

1. d4 {Must keep: core tournament repertoire.} Nf6 2. c4 e6
3. g3 {Keep intentionally: preferred fianchetto structure.} d5
4. Bg2 Be7 5. Nf3 O-O 6. O-O {Already understood; train as an exception if needed.} *`,
  expected: { nodes: 11, leaves: 1, maxDepth: 11, transpositionGroups: 0 },
});

export const BLACK_REPERTOIRE_FIXTURE = fixture({
  id: "black-repertoire",
  description: "A Black repertoire covering king-pawn, queen-pawn, and flank-opening replies.",
  repertoireColor: "black",
  tags: ["black-repertoire", "broad-eco-families", "multimodal-structures"],
  pgn: `[Event "Strategic Fit fixture: Black Sicilian"]
[Result "*"]
[ChesstempoRepertoireColour "Black"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 *

[Event "Strategic Fit fixture: Black King's Indian"]
[Result "*"]
[ChesstempoRepertoireColour "Black"]

1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O *

[Event "Strategic Fit fixture: Black English"]
[Result "*"]
[ChesstempoRepertoireColour "Black"]

1. c4 e5 2. Nc3 Nf6 3. Nf3 Nc6 4. g3 Bb4 *`,
  expected: { nodes: 28, leaves: 3, maxDepth: 10, transpositionGroups: 0 },
});

export const STRATEGIC_FIT_FIXTURES = Object.freeze([
  WHITE_TRANSPOSITION_FIXTURE,
  UNEQUAL_DEPTH_FIXTURE,
  BROAD_ECO_FIXTURE,
  MULTIMODAL_STRUCTURE_FIXTURE,
  SHALLOW_LINES_FIXTURE,
  INTENTIONAL_ANNOTATIONS_FIXTURE,
  BLACK_REPERTOIRE_FIXTURE,
]);

export function parseStrategicFitFixture(value: StrategicFitFixture): GameTree {
  return GameTree.fromPgn(value.pgn);
}
