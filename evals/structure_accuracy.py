"""Structural-classifier accuracy harness. Engine-free.

Measures `structure.classify_structure` against labeled FENs: overall accuracy,
per-named-class precision/recall, and the list of misclassifications. No engine, no API.
`"unknown"` fixtures are negatives — they must NOT match any named structure (precision guard:
a wrong label misleads an LLM more than `unknown`, see REPERTOIRE_DESIGN.md Decision D2).

Run: uv run --with chess python evals/structure_accuracy.py
"""

import collections
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "server"))

import chess

import structure

# (fen, expected_class). Real positions from canonical lines; see commit history / explorer.
FIXTURES = [
    ("r1bqkb1r/pp3ppp/2n2n2/8/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1", "IQP"),
    ("r1bqkb1r/pp3ppp/2p2n2/3p4/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1", "Carlsbad"),
    ("r1bqkbnr/pp1p1ppp/2n5/8/2P1P3/8/PP3PPP/RNBQKBNR w KQkq - 0 1", "Maroczy"),
    ("r1b1kbnr/pp3ppp/1qn1p3/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R w KQkq - 3 6", "French"),
    ("rnb1k2r/pp2q1pp/2pbpn2/3p1p2/2PP4/1P3NP1/P3PPBP/RNBQ1RK1 w kq - 1 8", "Stonewall"),
    ("rnbq1rk1/1pp2pbp/3p1np1/p2Pp3/2P1P3/2N2N2/PP2BPPP/R1BQK2R w KQ - 0 8", "King's Indian"),
    ("rnbqk2r/pp3pbp/3p1np1/2pP4/4P3/2N2N2/PP3PPP/R1BQKB1R w KQkq - 2 8", "Benoni"),
    # negatives — must classify "unknown" (precision guards)
    (chess.STARTING_FEN, "unknown"),
    ("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "unknown"),  # 1.e4 e5
    ("r1bqkb1r/pp1n1ppp/2p1pn2/3p4/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 1 6", "unknown"),  # QGD/Slav (tension)
    ("r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", "unknown"),  # Ruy Lopez
]


def main() -> int:
    confusion: collections.Counter = collections.Counter()
    rows = []
    for fen, expected in FIXTURES:
        got = structure.classify_structure(chess.Board(fen))["structure_class"]
        confusion[(expected, got)] += 1
        rows.append((expected, got))

    total = len(FIXTURES)
    correct = sum(1 for e, g in rows if e == g)
    named = sorted({exp for _, exp in FIXTURES if exp != "unknown"})

    print("# Structural classifier accuracy\n")
    print(f"Overall: {correct}/{total} = {correct / total:.0%}\n")
    print("| class | precision | recall | tp | fp | fn |")
    print("|-------|----------:|-------:|---:|---:|---:|")
    for c in named:
        tp = confusion[(c, c)]
        fp = sum(v for (e, g), v in confusion.items() if g == c and e != c)
        fn = sum(v for (e, g), v in confusion.items() if e == c and g != c)
        prec = tp / (tp + fp) if tp + fp else 1.0
        rec = tp / (tp + fn) if tp + fn else 1.0
        print(f"| {c} | {prec:.2f} | {rec:.2f} | {tp} | {fp} | {fn} |")

    # false positives on negatives (named label given to an "unknown" fixture)
    false_pos = [(e, g) for e, g in rows if e == "unknown" and g != "unknown"]
    misses = [(e, g) for e, g in rows if e != g]
    print(f"\nFalse positives on negatives: {len(false_pos)}")
    if misses:
        print("Misclassifications (expected → got):")
        for e, g in misses:
            print(f"- {e} → {g}")
    else:
        print("No misclassifications.")
    return 0 if not misses else 1


if __name__ == "__main__":
    raise SystemExit(main())
