"""Engine-free tests for structure.py and repertoire.py.

Run from the server project (pytest + pytest-cov are in the dev dependency-group;
branch coverage is enabled via addopts in pyproject.toml):
    cd server && uv run pytest
"""

import io
import time

import chess
import chess.pgn
import pytest

import structure
import repertoire
import openings


# ---------------------------------------------------------------------------
# Fixtures / shared positions
# ---------------------------------------------------------------------------

# Clean IQP: White d4 only in the center (no c/e pawns); Black has no d-pawn.
IQP_FEN = "r1bqkb1r/pp3ppp/2n2n2/8/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1"
# Carlsbad: White d4 + half-open c-file; Black d5, c-pawn, no e-pawn.
CARLSBAD_FEN = "r1bqkb1r/pp3ppp/2p2n2/3p4/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1"
# Maroczy: White c4 + e4, no d-pawn.
MAROCZY_FEN = "r1bqkbnr/pp1p1ppp/2n5/8/2P1P3/8/PP3PPP/RNBQKBNR w KQkq - 0 1"
# French Advance: White e5+d4 vs Black e6+d5.
FRENCH_FEN = "r1b1kbnr/pp3ppp/1qn1p3/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R w KQkq - 3 6"
# Stonewall (Black): d5/e6/f5 wall.
STONEWALL_FEN = "rnb1k2r/pp2q1pp/2pbpn2/3p1p2/2PP4/1P3NP1/P3PPBP/RNBQ1RK1 w kq - 1 8"
# King's Indian (locked): White c4/d5/e4 vs Black d6/e5/g6.
KID_FEN = "rnbq1rk1/1pp2pbp/3p1np1/p2Pp3/2P1P3/2N2N2/PP2BPPP/R1BQK2R w KQ - 0 8"
# Benoni: White d5+e4 vs Black c5+d6, half-open e-file.
BENONI_FEN = "rnbqk2r/pp3pbp/3p1np1/2pP4/4P3/2N2N2/PP3PPP/R1BQKB1R w KQkq - 2 8"
# Closed Sicilian (Grand Prix): White e4/d3/f4 vs Black c5/d6.
CLOSED_SICILIAN_FEN = (
    "r1bqk1nr/pp2ppbp/2np2p1/2p5/4PP2/2NP2P1/PPP3BP/R1BQK1NR b KQkq - 0 6"
)

SAMPLE_PGN = """\
[Event "Test"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 ( 5. Nf3 c6 6. Qc2 Be7 ) 5... Be7 *
"""

DUAL_PGN = """\
[Event "Dual structure test"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 ( 4... Nxd5 5. e4 Nxc3 6. bxc3 ) *
"""


def pawns(*placements: tuple[int, bool]) -> chess.Board:
    """Empty board with the given (square, is_white) pawns plus both kings."""
    b = chess.Board(None)
    b.set_piece_at(chess.E1, chess.Piece(chess.KING, chess.WHITE))
    b.set_piece_at(chess.E8, chess.Piece(chess.KING, chess.BLACK))
    for sq, white in placements:
        b.set_piece_at(sq, chess.Piece(chess.PAWN, white))
    return b


@pytest.fixture
def sample_game() -> chess.pgn.Game:
    return chess.pgn.read_game(io.StringIO(SAMPLE_PGN))


@pytest.fixture(autouse=True)
def _clear_cache():
    """Each test starts with an empty repertoire cache."""
    repertoire._CACHE.clear()
    yield
    repertoire._CACHE.clear()


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def test_starting_position_has_no_weaknesses():
    start = chess.Board()
    assert structure.get_doubled_pawns(start, chess.WHITE) == []
    assert structure.get_doubled_pawns(start, chess.BLACK) == []
    assert structure.get_isolated_pawns(start, chess.WHITE) == []
    assert structure.get_passed_pawns(start, chess.WHITE) == []


def test_doubled_pawns():
    b = pawns((chess.C2, True), (chess.C3, True))
    assert structure.get_doubled_pawns(b, chess.WHITE) == ["c2", "c3"]


def test_isolated_pawns():
    b = pawns((chess.E4, True), (chess.A2, True), (chess.H2, True))
    iso = structure.get_isolated_pawns(b, chess.WHITE)
    assert set(iso) == {"a2", "e4", "h2"}  # all isolated: no adjacent-file neighbours


def test_pawn_not_isolated_with_neighbour():
    b = pawns((chess.E4, True), (chess.D3, True))
    assert "e4" not in structure.get_isolated_pawns(b, chess.WHITE)


@pytest.mark.parametrize("blocker", [chess.E7, chess.D6, chess.F6])
def test_passed_pawn_blocked_by_enemy(blocker):
    b = pawns((chess.E5, True), (blocker, False))
    assert structure.get_passed_pawns(b, chess.WHITE) == []


def test_passed_pawn_with_no_blocker():
    b = pawns((chess.E5, True), (chess.A7, False))
    assert "e5" in structure.get_passed_pawns(b, chess.WHITE)


def test_pawn_chain():
    b = pawns((chess.D4, True), (chess.E5, True), (chess.C3, True))
    chains = structure.get_pawn_chains(b, chess.WHITE)
    assert len(chains) == 1
    assert len(chains[0]) == 3


def test_phalanx_is_not_a_chain():
    # Side-by-side pawns are not diagonally connected → not a chain.
    b = pawns((chess.D4, True), (chess.E4, True))
    assert structure.get_pawn_chains(b, chess.WHITE) == []


def test_half_open_and_open_files():
    b = pawns((chess.D4, True), (chess.D7, False), (chess.C7, False))
    assert "c" in structure.get_half_open_files(b, chess.WHITE)  # White lacks a c-pawn
    assert "d" not in structure.get_half_open_files(b, chess.WHITE)  # both have d-pawns
    open_files = structure.get_open_files(b)
    assert "c" not in open_files and "d" not in open_files  # each has a pawn
    assert "f" in open_files


# ---------------------------------------------------------------------------
# Center state
# ---------------------------------------------------------------------------


def test_center_tense_white_capture():
    b = pawns((chess.E4, True), (chess.D5, False))
    assert structure.center_state(b) == "tense"


def test_center_tense_is_symmetric():
    # Black's central d5 contacts White's c4 (c4 is not itself a central-file pawn).
    b = pawns((chess.C4, True), (chess.D5, False))
    assert structure.center_state(b) == "tense"


def test_center_locked():
    b = pawns((chess.E4, True), (chess.E5, False))
    assert structure.center_state(b) == "locked"


def test_center_open():
    b = pawns((chess.A2, True), (chess.H7, False))  # no central pawns
    assert structure.center_state(b) == "open"


# ---------------------------------------------------------------------------
# Theme tags (A)
# ---------------------------------------------------------------------------


def test_themes_fianchetto_both_sides():
    b = chess.Board("6k1/6b1/8/8/8/8/6B1/6K1 w - - 0 1")  # White Bg2, Black Bg7
    t = structure.themes(b, chess.WHITE)
    assert t["fianchetto_white"] is True
    assert t["fianchetto_black"] is True


def test_themes_no_fianchetto_on_home_bishops():
    t = structure.themes(chess.Board(), chess.WHITE)
    assert t["fianchetto_white"] is False and t["fianchetto_black"] is False


def test_themes_space_counts_advanced_pawns():
    b = pawns((chess.E4, True), (chess.D4, True), (chess.A2, True))
    t = structure.themes(b, chess.WHITE)
    assert t["space_white"] == 2  # e4, d4 on rank 4; a2 is home


def test_themes_wing_majority():
    # White 3 queenside pawns vs Black 2; kingside equal (4 each) → White qs majority.
    b = pawns(
        (chess.A2, True),
        (chess.B2, True),
        (chess.C2, True),
        (chess.E2, True),
        (chess.F2, True),
        (chess.G2, True),
        (chess.H2, True),
        (chess.A7, False),
        (chess.B7, False),
        (chess.E7, False),
        (chess.F7, False),
        (chess.G7, False),
        (chess.H7, False),
    )
    t = structure.themes(b, chess.WHITE)
    assert t["wing_majority_white"] == "queenside"
    assert t["wing_majority_black"] is None


def test_themes_minority_attack_carlsbad_motif():
    # White has 2 queenside pawns (a,b) vs Black's 3 (a,b,c) + half-open c-file → minority attack.
    b = pawns(
        (chess.A2, True),
        (chess.B2, True),
        (chess.A7, False),
        (chess.B7, False),
        (chess.C7, False),
    )
    t = structure.themes(b, chess.WHITE)
    assert t["minority_attack_white"] is True


def test_themes_minority_attack_kingside():
    # Mirror motif on the kingside: White 2 (g,h) vs Black 3 (f,g,h) + half-open f.
    b = pawns(
        (chess.G2, True),
        (chess.H2, True),
        (chess.F7, False),
        (chess.G7, False),
        (chess.H7, False),
    )
    assert structure.themes(b, chess.WHITE)["minority_attack_white"] is True


def test_themes_color_complex_skew():
    # All White pawns on dark squares → the light-square complex is the weak one.
    b = pawns((chess.B2, True), (chess.D2, True), (chess.F2, True), (chess.H2, True))
    assert structure.themes(b, chess.WHITE)["color_complex"] == "light"


def test_themes_color_complex_dark():
    # All White pawns on light squares → the dark-square complex is weak.
    b = pawns((chess.A2, True), (chess.C2, True), (chess.E2, True), (chess.G2, True))
    assert structure.themes(b, chess.WHITE)["color_complex"] == "dark"


def test_themes_symmetric_has_no_majority_or_complex():
    t = structure.themes(chess.Board(), chess.WHITE)  # starting position is symmetric
    assert t["wing_majority_white"] is None and t["wing_majority_black"] is None
    assert t["color_complex"] is None
    assert t["flank_vs_center"] is False


def test_themes_flank_vs_center():
    b = pawns((chess.D4, True), (chess.E4, True), (chess.A7, False), (chess.H7, False))
    assert structure.themes(b, chess.WHITE)["flank_vs_center"] is True


def test_themes_always_populated_when_structure_unknown():
    # The whole point of A: themes carry signal even where classify_structure gives up.
    prof = structure.position_profile(chess.Board(), chess.WHITE)
    assert prof["structure_class"] == "unknown"
    assert isinstance(prof["themes"], dict) and prof["themes"]  # non-empty
    # flat: no nested dicts under themes (MCP nesting budget)
    assert all(not isinstance(v, dict) for v in prof["themes"].values())


# Real English-Opening bxc3 leaf from repertoires/ct-white/analysis.md: the position
# that returned structure_class "unknown" and motivated the theme-tag work (A).
ENGLISH_BXC3_FEN = "1rbq1rk1/ppp2pp1/2nb3p/4p3/3P4/2P2NP1/P1Q1PPBP/1RB2RK1 b - - 1 11"


def test_english_bxc3_leaf_now_classifies_grunfeld_centre():
    # The original analysis profiled this leaf as unknown/0.0. After C it classifies as
    # Grünfeld Centre (single c3+d4, half-open b, e-pawn home → no e4 bonus → base 0.7),
    # and themes still describe the g2 fianchetto + half-open b-file (the bxc3 artifact).
    prof = structure.position_profile(chess.Board(ENGLISH_BXC3_FEN), chess.WHITE)
    assert prof["structure_class"] == "Grünfeld Centre"
    assert prof["confidence"] == 0.7
    assert prof["themes"]["fianchetto_white"] is True
    assert "b" in prof["half_open_files"]


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fen,expected",
    [
        (IQP_FEN, "IQP"),
        (CARLSBAD_FEN, "Carlsbad"),
        (MAROCZY_FEN, "Maroczy"),
        (FRENCH_FEN, "French"),
        (STONEWALL_FEN, "Stonewall"),
        (KID_FEN, "King's Indian"),
        (BENONI_FEN, "Benoni"),
        (CLOSED_SICILIAN_FEN, "Closed Sicilian"),
        (chess.STARTING_FEN, "unknown"),
        (
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
            "unknown",
        ),  # 1.e4 e5
    ],
)
def test_classify_structure(fen, expected):
    assert structure.classify_structure(chess.Board(fen))["structure_class"] == expected


@pytest.mark.parametrize(
    "fen",
    [
        IQP_FEN,
        CARLSBAD_FEN,
        MAROCZY_FEN,
        FRENCH_FEN,
        STONEWALL_FEN,
        KID_FEN,
        BENONI_FEN,
        CLOSED_SICILIAN_FEN,
    ],
)
def test_named_structures_have_confidence(fen):
    assert structure.classify_structure(chess.Board(fen))["confidence"] >= 0.7


def test_unknown_has_zero_confidence():
    assert structure.classify_structure(chess.Board())["confidence"] == 0.0


def test_home_d_pawn_is_not_iqp():
    # An isolated home d2 pawn is NOT an IQP (which is an advanced central isolani).
    b = pawns((chess.D2, True), (chess.A7, False))
    assert structure._iqp_confidence(b, chess.WHITE) == 0.0


def test_d4_isolani_is_iqp():
    b = pawns((chess.D4, True), (chess.A7, False))
    assert structure._iqp_confidence(b, chess.WHITE) == 0.9


def test_position_profile_shape():
    prof = structure.position_profile(chess.Board(IQP_FEN), chess.WHITE)
    assert "fen" in prof and "primitives" in prof
    assert prof["structure_class"] == "IQP"
    # nesting stays <= 2 levels: primitives values are lists, not dicts
    assert all(not isinstance(v, dict) for v in prof["primitives"].values())


# ---------------------------------------------------------------------------
# Graded confidence + brittleness tolerance + bidirectional (B)
# ---------------------------------------------------------------------------


def test_graded_gate_blocks_without_core():
    assert structure._graded(False, 5, base=0.7, cap=0.9) == 0.0


def test_graded_scales_with_bonus_and_caps():
    assert structure._graded(True, 0, base=0.6, cap=0.7) == 0.6
    assert structure._graded(True, 2, base=0.6, cap=0.7) == 0.7  # 0.6 + 2*0.05
    assert structure._graded(True, 9, base=0.6, cap=0.7) == 0.7  # clamped to cap


def test_kid_brittleness_missing_c4_still_classifies():
    # KID core (d5/e4 vs e5/d6) without the c4 bonus pawn: exact matching gave 0.0;
    # core+bonus keeps it classified, just below the full-confidence 0.85.
    b = pawns(
        (chess.D5, True),
        (chess.E4, True),
        (chess.E5, False),
        (chess.D6, False),
        (chess.G6, False),
    )
    out = structure.classify_structure(b)
    assert out["structure_class"] == "King's Indian"
    assert 0.7 <= out["confidence"] < 0.85


def test_closed_sicilian_brittleness_missing_d3():
    b = pawns((chess.E4, True), (chess.F4, True), (chess.C5, False))  # no d3/d6 bonus
    out = structure.classify_structure(b)
    assert out["structure_class"] == "Closed Sicilian"
    assert out["confidence"] == 0.6


def test_closed_sicilian_bidirectional_black_side():
    # Reversed-English Grand Prix: Black runs the e5/f5 wall vs White's c4.
    b = pawns((chess.E5, False), (chess.F5, False), (chess.C4, True))
    assert structure._closed_sicilian_confidence(b, chess.BLACK) > 0
    assert structure.classify_structure(b)["structure_class"] == "Closed Sicilian"


def test_reversed_colour_branches():
    french = pawns(
        (chess.D4, True), (chess.E3, True), (chess.D5, False), (chess.E4, False)
    )
    assert structure._french_confidence(french) == 0.6
    benoni = pawns(
        (chess.D4, False), (chess.E5, False), (chess.C4, True), (chess.D3, True)
    )
    assert structure._benoni_confidence(benoni) == 0.6
    kid = pawns(
        (chess.D4, False),
        (chess.E5, False),
        (chess.C5, False),
        (chess.E4, True),
        (chess.D3, True),
        (chess.G3, True),
    )
    assert structure._kid_confidence(kid) == 0.6


# ---------------------------------------------------------------------------
# Canonical-canon scorers (C) — every FEN is MCP-verified (design §8 provenance log)
# ---------------------------------------------------------------------------

# (structure_class, canonical FEN from the provenance log)
CANON_C_FENS = [
    (
        "Nimzo-Grünfeld",
        "rnbqk2r/p1pp1ppp/1p2pn2/8/2PP4/P1P1P3/5PPP/R1BQKBNR b KQkq - 0 6",
    ),
    ("Grünfeld Centre", "rnbqkb1r/ppp1pp1p/6p1/8/3PP3/2P5/P4PPP/R1BQKBNR b KQkq - 0 6"),
    ("Hedgehog", "rnbqkb1r/5ppp/pp1ppn2/8/2PNP3/2N5/PP2BPPP/R1BQK2R w KQkq - 0 8"),
    ("Najdorf", "rnbqkb1r/1p3ppp/p2p1n2/4p3/3NP3/2N5/PPP1BPPP/R1BQK2R w KQkq - 0 7"),
    ("Scheveningen", "rnbqkb1r/1p3ppp/p2ppn2/8/3NP3/2N5/PPP1BPPP/R1BQK2R w KQkq - 0 7"),
    ("Caro-Kann", "rn1qkbnr/pp3ppp/2p1p3/3pPb2/3P4/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 5"),
    ("Slav", "rn1qkb1r/pp3ppp/2p1pn2/3p1b2/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 6"),
    ("Lopez", "r1bq1rk1/2p1bppp/p1np1n2/1p2p3/4P3/1BPP1N2/PP3PPP/RNBQR1K1 b - - 0 9"),
    ("Benko", "rn1qkb1r/4pppp/b2p1n2/2pP4/8/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 7"),
    ("Hanging pawns", "rnb2rk1/p3qpp1/7p/2pp4/8/4PN2/PP2BPPP/R2QK2R w KQ - 0 13"),
    (
        "Symmetric Benoni",
        "rnbqk2r/pp2bppp/3p1n2/2pPp3/2P1P3/2N5/PP3PPP/R1BQKBNR w KQkq - 1 6",
    ),
]


@pytest.mark.parametrize("expected,fen", CANON_C_FENS)
def test_canon_c_scorer_classifies_its_model_position(expected, fen):
    out = structure.classify_structure(chess.Board(fen))
    assert out["structure_class"] == expected
    assert out["confidence"] >= 0.7


def test_hedgehog_outscores_maroczy_by_specificity():
    # Hedgehog's a6/b6/d6/e6 wall (4 pawns) beats a bare Maroczy (c4/e4) on the same FEN.
    hedgehog = "rnbqkb1r/5ppp/pp1ppn2/8/2PNP3/2N5/PP2BPPP/R1BQK2R w KQkq - 0 8"
    board = chess.Board(hedgehog)
    assert structure._maroczy_confidence(board) > 0  # Maroczy also fires...
    assert (
        structure.classify_structure(board)["structure_class"] == "Hedgehog"
    )  # ...but loses


def test_nimzo_grunfeld_vs_grunfeld_centre_split_on_doubled_c():
    # Doubled c3+c4 → Nimzo-Grünfeld; single c3 → Grünfeld Centre. Mutually exclusive.
    nimzo = chess.Board(
        "rnbqk2r/p1pp1ppp/1p2pn2/8/2PP4/P1P1P3/5PPP/R1BQKBNR b KQkq - 0 6"
    )
    assert (
        structure._grunfeld_center_confidence(nimzo) == 0.0
    )  # c4 present → not Grünfeld
    grunfeld = chess.Board(
        "rnbqkb1r/ppp1pp1p/6p1/8/3PP3/2P5/P4PPP/R1BQKBNR b KQkq - 0 6"
    )
    assert structure._nimzo_grunfeld_confidence(grunfeld) == 0.0  # single c → not Nimzo


def test_symmetric_vs_asymmetric_benoni_split_on_e_pawn():
    # Asymmetric Benoni gates on a half-open e-file (no Black e-pawn); Symmetric keeps e5.
    symmetric = chess.Board(
        "rnbqk2r/pp2bppp/3p1n2/2pPp3/2P1P3/2N5/PP3PPP/R1BQKBNR w KQkq - 1 6"
    )
    assert (
        structure._benoni_confidence(symmetric) == 0.0
    )  # Black e5 present → not Asymmetric


def test_grunfeld_centre_requires_half_open_b():
    # Negative guard: c3+d4 but a b-pawn present (b-file not half-open) → no false label.
    b = pawns((chess.C3, True), (chess.D4, True), (chess.B2, True), (chess.A7, False))
    assert structure._grunfeld_center_confidence(b) == 0.0


# The open-Sicilian family is bidirectional: mirroring a canonical FEN (board.mirror()
# swaps colours + flips ranks) gives the reversed-English form where Black holds the
# space. It must classify as the SAME structure.
FAMILY2_FENS = [
    (name, fen)
    for name, fen in CANON_C_FENS
    if name in {"Hedgehog", "Najdorf", "Scheveningen"}
]


@pytest.mark.parametrize("expected,fen", FAMILY2_FENS)
def test_family2_scorers_are_bidirectional(expected, fen):
    mirrored = chess.Board(fen).mirror()  # reversed-English: Black carries the space
    assert mirrored.fen() != fen
    assert structure.classify_structure(mirrored)["structure_class"] == expected


# ---------------------------------------------------------------------------
# Walker
# ---------------------------------------------------------------------------


def test_tree_stats(sample_game):
    nodes, leaves, depth = repertoire.tree_stats(sample_game)
    assert nodes > 0
    assert leaves == 2
    assert depth > 4


def test_resolve_valid_path(sample_game):
    node = repertoire.resolve_path(sample_game, ["d4", "d5", "c4", "e6"])
    assert node is not None


def test_resolve_invalid_path_returns_none(sample_game):
    # e5 is illegal as a child of 1.d4 (no such move in the tree)
    assert repertoire.resolve_path(sample_game, ["d4", "e5"]) is None


def test_san_path_round_trip(sample_game):
    node = repertoire.resolve_path(sample_game, ["d4", "d5"])
    assert repertoire.san_path(node) == ["d4", "d5"]


def test_walk_leaves_yields_childless_nodes(sample_game):
    leaves = list(repertoire.walk_leaves(sample_game))
    _, leaf_count, _ = repertoire.tree_stats(sample_game)
    assert len(leaves) == leaf_count
    assert all(not leaf.variations for leaf in leaves)


# ---------------------------------------------------------------------------
# Multi-game merge (Chesstempo exports one [Event] per opening — Issue #13)
# ---------------------------------------------------------------------------

# Three openings in one file, each a distinct first move (1.d4 / 1.e4 / 1.c4).
MULTI_PGN = """\
[Event "G1"]
[Result "*"]

1. d4 d5 2. c4 e6 *

[Event "G2"]
[Result "*"]

1. e4 c6 2. d4 d5 *

[Event "G3"]
[Result "*"]

1. c4 Nf6 ( 1... e5 2. Nc3 ) 2. Nc3 *
"""


def _games(pgn: str) -> list[chess.pgn.Game]:
    stream = io.StringIO(pgn)
    out = []
    while (g := chess.pgn.read_game(stream)) is not None:
        if g.next() is not None:
            out.append(g)
    return out


def test_merge_games_unions_all_first_moves():
    merged = repertoire.merge_games(_games(MULTI_PGN))
    first_moves = {merged.board().san(c.move) for c in merged.variations}
    assert first_moves == {"d4", "e4", "c4"}


def test_merge_games_tree_stats_sum_all_games():
    games = _games(MULTI_PGN)
    per_game = [repertoire.tree_stats(g) for g in games]
    merged = repertoire.merge_games(games)
    m_nodes, m_leaves, m_depth = repertoire.tree_stats(merged)
    assert m_nodes == sum(n for n, _, _ in per_game)
    assert m_leaves == sum(lv for _, lv, _ in per_game)
    assert m_depth == max(d for _, _, d in per_game)


def test_merge_games_paths_resolve_across_games():
    merged = repertoire.merge_games(_games(MULTI_PGN))
    assert repertoire.resolve_path(merged, ["e4", "c6", "d4", "d5"]) is not None
    assert repertoire.resolve_path(merged, ["c4", "e5", "Nc3"]) is not None


def test_merge_games_shared_first_move_collapses():
    # Two games both starting 1.d4 — the shared root child must not duplicate.
    pgn = '[Event "A"]\n\n1. d4 d5 *\n\n[Event "B"]\n\n1. d4 Nf6 *\n'
    merged = repertoire.merge_games(_games(pgn))
    d4_children = [c for c in merged.variations if merged.board().san(c.move) == "d4"]
    assert len(d4_children) == 1
    replies = {d4_children[0].board().san(c.move) for c in d4_children[0].variations}
    assert replies == {"d5", "Nf6"}


def test_merge_games_single_game_unchanged():
    game = chess.pgn.read_game(io.StringIO(SAMPLE_PGN))
    expected = repertoire.tree_stats(game)
    merged = repertoire.merge_games([chess.pgn.read_game(io.StringIO(SAMPLE_PGN))])
    assert repertoire.tree_stats(merged) == expected


def test_merge_games_skips_non_standard_start():
    # A game starting from a FEN-set position cannot graft onto the standard root.
    fen_game = (
        '[Event "FEN start"]\n'
        '[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n'
        '[SetUp "1"]\n\n1... c5 *\n'
    )
    games = _games(SAMPLE_PGN + "\n" + fen_game)
    merged = repertoire.merge_games(games)
    # Only the standard-start SAMPLE_PGN game survives the merge.
    assert repertoire.tree_stats(merged) == repertoire.tree_stats(
        chess.pgn.read_game(io.StringIO(SAMPLE_PGN))
    )


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def test_store_and_get():
    game = chess.pgn.read_game(io.StringIO(SAMPLE_PGN))
    summary = repertoire.store_repertoire(game, chess.WHITE)
    assert summary["color"] == "white"
    assert summary["nodes"] > 0
    rep = repertoire.get_repertoire(summary["repertoire_id"])
    assert rep is not None and rep.color == chess.WHITE


def test_get_unknown_id_returns_none():
    assert repertoire.get_repertoire("nonexistent") is None


def test_store_sweeps_expired_entries():
    g1 = chess.pgn.read_game(io.StringIO(SAMPLE_PGN))
    rid1 = repertoire.store_repertoire(g1, chess.WHITE)["repertoire_id"]
    repertoire._CACHE[rid1].touched = time.time() - repertoire.REPERTOIRE_TTL_S - 1
    # storing another repertoire runs _evict_locked, which sweeps the expired entry
    repertoire.store_repertoire(
        chess.pgn.read_game(io.StringIO(SAMPLE_PGN)), chess.WHITE
    )
    assert rid1 not in repertoire._CACHE


def test_ttl_expiry():
    game = chess.pgn.read_game(io.StringIO(SAMPLE_PGN))
    rid = repertoire.store_repertoire(game, chess.WHITE)["repertoire_id"]
    repertoire._CACHE[rid].touched = time.time() - repertoire.REPERTOIRE_TTL_S - 1
    assert repertoire.get_repertoire(rid) is None


def test_lru_eviction(monkeypatch):
    # Leak control: storing past MAX_REPERTOIRES evicts the least-recently-used.
    monkeypatch.setattr(repertoire, "MAX_REPERTOIRES", 2)
    ids = [
        repertoire.store_repertoire(
            chess.pgn.read_game(io.StringIO(SAMPLE_PGN)), chess.WHITE
        )["repertoire_id"]
        for _ in range(3)
    ]
    assert len(repertoire._CACHE) == 2
    assert repertoire.get_repertoire(ids[0]) is None  # oldest evicted
    assert repertoire.get_repertoire(ids[2]) is not None  # newest retained


# ---------------------------------------------------------------------------
# Aggregate profile & congruence
# ---------------------------------------------------------------------------


def _make_rep(pgn: str) -> repertoire._Repertoire:
    game = chess.pgn.read_game(io.StringIO(pgn))
    now = time.time()
    return repertoire._Repertoire(
        game=game,
        color=chess.WHITE,
        created=now,
        touched=now,
        nodes=0,
        leaves=0,
        max_depth=0,
    )


def test_aggregate_profile_shape():
    rep = _make_rep(SAMPLE_PGN)
    agg = repertoire.aggregate_profile(rep)
    assert agg["leaves_analyzed"] == len(list(repertoire.walk_leaves(rep.game)))
    for key in (
        "structures",
        "themes",
        "center_distribution",
        "common_open_files",
        "common_half_open_files",
    ):
        assert key in agg


FIANCHETTO_PGN = """\
[Event "Fianchetto English"]
[Result "*"]

1. c4 Nf6 2. Nc3 g6 3. g3 Bg7 4. Bg2 O-O 5. e4 d6 6. Nge2 e5 *
"""


def test_aggregate_themes_rollup_carries_unknown_fianchetto_lines():
    # The fianchetto English classifies as `unknown` (it's a system, not a named pawn
    # structure) — but the aggregate theme rollup still surfaces its DNA.
    rep = _make_rep(FIANCHETTO_PGN)
    agg = repertoire.aggregate_profile(rep)
    assert agg["structures"][0]["structure_class"] == "unknown"  # no named structure
    assert agg["themes"]["fianchetto_white"] >= 1  # ...but the rollup catches it
    assert "avg_space_white" in agg["themes"] and "avg_space_black" in agg["themes"]


def test_congruence_shape_and_drilldown():
    rep = _make_rep(DUAL_PGN)
    result = repertoire.analyze_congruence(rep, min_severity="low", limit=10)
    assert isinstance(result["total_flagged"], int)
    assert isinstance(result["by_type"], dict)
    assert isinstance(result["incongruencies"], list)
    assert len(result["incongruencies"]) <= 10
    for item in result["incongruencies"]:
        assert "paths" in item  # drill-down handle for get_structural_profile


def test_congruence_limit_respected():
    rep = _make_rep(SAMPLE_PGN)
    result = repertoire.analyze_congruence(rep, min_severity="low", limit=1)
    assert len(result["incongruencies"]) <= 1


# ---------------------------------------------------------------------------
# Congruence — rule FIRING (each line reaches a verified structure / center).
# ---------------------------------------------------------------------------

LINE_CARLSBAD = "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7"  # Carlsbad, locked center
LINE_MAROCZY = "c4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 e4"  # Maroczy
LINE_IQP = "d4 d5 c4 e6 Nc3 c5 cxd5 exd5 dxc5"  # White IQP
LINE_DOUBLED = (
    "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 Bxc3 bxc3"  # White doubled c-pawns (unknown)
)
LINE_OPEN = "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nc3 Bb4 Nxc6 dxc6"  # open center (unknown)
LINE_QGD_CLEAN = "d4 d5 c4 e6 Nf3 Nf6 Nc3 c6 e3 Nbd7"  # d4, Slav, clean structure
LINE_E4_LOCKED = "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 d3 b5 Bb3 d6"  # e4, Lopez, locked center
# Congruence groups leaves by opening (opponent's first move, Issue #14); the firing
# tests below use lines that SHARE a first move so they fall in one opening's group.


def _line_moves(sans: str) -> list[chess.Move]:
    b = chess.Board()
    return [b.push_san(s) for s in sans.split()]


def build_repertoire(
    lines: list[str], color: chess.Color = chess.WHITE
) -> repertoire._Repertoire:
    """Assemble a _Repertoire from SAN line strings, merging shared prefixes into a tree."""
    game = chess.pgn.Game()
    for sans in lines:
        node = game
        for mv in _line_moves(sans):
            child = next((c for c in node.variations if c.move == mv), None)
            node = child or node.add_variation(mv)
    now = time.time()
    return repertoire._Repertoire(game, color, now, now, 0, 0, 0)


def test_congruence_flags_structure_outlier():
    # Two d4 lines (one opening), distinct structures → the minority structure is flagged.
    rep = build_repertoire([LINE_CARLSBAD, LINE_IQP])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("structure_outlier") == 1
    item = next(i for i in result["incongruencies"] if i["type"] == "structure_outlier")
    assert item["paths"] and item["severity"] in ("medium", "high")


def test_congruence_flags_weakness_inconsistency():
    # Three d4 lines (one opening), one with doubled pawns → minority weakness flagged.
    rep = build_repertoire([LINE_CARLSBAD, LINE_QGD_CLEAN, LINE_DOUBLED])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("weakness_inconsistency") == 1


def test_congruence_flags_center_inconsistency():
    # Two e4 lines (one opening): one locks the center, one opens it.
    rep = build_repertoire([LINE_E4_LOCKED, LINE_OPEN])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("center_inconsistency") == 1


def test_congruence_no_dominant_structure_flags_no_outlier():
    # three distinct known structures in one opening, none >= 50% → no structure_outlier
    rep = build_repertoire([LINE_CARLSBAD, LINE_IQP, LINE_QGD_CLEAN])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("structure_outlier") is None


def test_congruence_no_cross_opening_flags():
    # Issue #14: distinct openings (d4 Carlsbad vs c4 Maroczy) are NOT outliers of each
    # other — each leaf is judged within its own opening, not the whole forest.
    rep = build_repertoire([LINE_CARLSBAD, LINE_MAROCZY])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("structure_outlier") is None


def test_congruence_weakness_scoped_to_opening():
    # Issue #14: the lone d4 weakness line is a forest minority (1/3) — the old whole-forest
    # check flagged it. Grouped by opening it is alone in the d4 group (majority of its own
    # opening), so it is no longer flagged. Each opening is judged on its own grain.
    rep = build_repertoire([LINE_DOUBLED, LINE_MAROCZY, LINE_OPEN])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("weakness_inconsistency") is None


def test_congruence_all_unknown_flags_nothing():
    # both leaves classify unknown → the structure_outlier block is skipped entirely
    rep = build_repertoire([LINE_OPEN, LINE_DOUBLED])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("structure_outlier") is None


def test_congruence_min_severity_filters():
    rep = build_repertoire([LINE_CARLSBAD, LINE_IQP])  # one opening; outlier is 'medium'
    low = repertoire.analyze_congruence(rep, "low", 10)
    high = repertoire.analyze_congruence(rep, "high", 10)
    assert any(i["type"] == "structure_outlier" for i in low["incongruencies"])
    assert high["total_flagged"] <= low["total_flagged"]
    assert all(i["severity"] == "high" for i in high["incongruencies"])


def test_profile_structure_shares():
    rep = build_repertoire([LINE_CARLSBAD, LINE_MAROCZY])
    shares = repertoire.profile_structure_shares(rep)
    assert abs(sum(shares.values()) - 1.0) < 1e-9
    assert shares.get("Carlsbad") == 0.5 and shares.get("Maroczy") == 0.5


def test_aggregate_profile_content():
    rep = build_repertoire([LINE_CARLSBAD, LINE_MAROCZY])
    agg = repertoire.aggregate_profile(rep)
    classes = {s["structure_class"] for s in agg["structures"]}
    assert {"Carlsbad", "Maroczy"} <= classes
    assert agg["leaves_analyzed"] == 2


# ---------------------------------------------------------------------------
# Black-side primitives & classifier (direction-sensitive logic must hold for Black).
# ---------------------------------------------------------------------------


def test_passed_pawn_black():
    b = pawns((chess.E4, False), (chess.A2, True))  # nothing white ahead of Black's e4
    assert "e4" in structure.get_passed_pawns(b, chess.BLACK)


def test_passed_pawn_black_blocked_by_adjacent():
    b = pawns(
        (chess.E4, False), (chess.D3, True)
    )  # white d3 is ahead+adjacent for Black
    assert structure.get_passed_pawns(b, chess.BLACK) == []


def test_pawn_chain_black():
    # Black d5 defends e4 (Black's forward diagonal is toward rank 1) → a chain.
    b = pawns((chess.D5, False), (chess.E4, False))
    chains = structure.get_pawn_chains(b, chess.BLACK)
    assert len(chains) == 1 and len(chains[0]) == 2


def test_isolated_pawn_black():
    b = pawns((chess.E5, False), (chess.A7, False), (chess.H7, False))
    assert "e5" in structure.get_isolated_pawns(b, chess.BLACK)


def test_black_iqp_classified():
    b = pawns(
        (chess.D5, False), (chess.A2, True)
    )  # Black d5 isolani, White has no d-pawn
    assert structure._iqp_confidence(b, chess.BLACK) == 0.9


def test_iqp_rejected_when_opponent_has_d_pawn():
    b = pawns(
        (chess.D4, True), (chess.D7, False)
    )  # White d4 isolani but Black still has d7
    assert structure._iqp_confidence(b, chess.WHITE) == 0.0


def test_iqp_advanced_rank_scores_lower():
    b = pawns(
        (chess.D5, True), (chess.A7, False)
    )  # White d5 (advanced, not the classic d4)
    assert structure._iqp_confidence(b, chess.WHITE) == 0.6


def test_carlsbad_rejected_when_owner_keeps_c_pawn():
    b = pawns((chess.D4, True), (chess.C2, True), (chess.D5, False), (chess.C6, False))
    assert (
        structure._carlsbad_confidence(b) == 0.0
    )  # White still has a c-pawn → not Carlsbad


def test_maroczy_mirrored_black_binds():
    b = pawns(
        (chess.C5, False), (chess.E5, False), (chess.A2, True)
    )  # Black c5+e5, no d-pawn
    assert structure._maroczy_confidence(b) == 0.7


def test_carlsbad_mirrored_black_half_open_c():
    # Black d5 + half-open c-file; White d4, keeps c-pawn, no e-pawn → mirrored Carlsbad.
    b = pawns((chess.D5, False), (chess.D4, True), (chess.C2, True))
    assert structure._carlsbad_confidence(b) == 0.7


def test_center_semi_open():
    b = pawns(
        (chess.D4, True), (chess.E6, False)
    )  # central pawns, no contact, not locked
    assert structure.center_state(b) == "semi-open"


# ---------------------------------------------------------------------------
# Walker edge cases.
# ---------------------------------------------------------------------------


def test_resolve_path_illegal_san_returns_none(sample_game):
    assert repertoire.resolve_path(sample_game, ["Zz9"]) is None


def test_resolve_path_empty_returns_root(sample_game):
    assert repertoire.resolve_path(sample_game, []) is sample_game


def test_find_transpositions():
    # two move orders reaching the same position
    rep = build_repertoire(["d4 Nf6 c4 g6", "c4 g6 d4 Nf6"])
    groups = repertoire.find_transpositions(rep.game)
    assert len(groups) >= 1
    big = max(groups, key=lambda g: len(g["paths"]))
    assert len(big["paths"]) == 2
    assert ["d4", "Nf6", "c4", "g6"] in big["paths"]
    assert ["c4", "g6", "d4", "Nf6"] in big["paths"]


def test_no_transpositions_in_linear_tree():
    rep = build_repertoire(["d4 d5 c4 e6 Nc3 Nf6"])
    assert repertoire.find_transpositions(rep.game) == []


# ---------------------------------------------------------------------------
# Opponent-reply nodes (find_repertoire_gaps engine-free seam)
# ---------------------------------------------------------------------------


def test_opponent_reply_nodes_white_skips_player_moves():
    # White repertoire: opponent (Black) decision points only, with >= 1 prepared reply.
    rep = build_repertoire(["d4 d5 c4 e6", "d4 d5 c4 dxc4"])
    nodes = repertoire.opponent_reply_nodes(rep)
    paths = [n["path"] for n in nodes]
    assert paths[0] == ["d4"]  # shallowest first
    assert ["d4", "d5", "c4"] in paths
    assert ["d4", "d5"] not in paths  # White-to-move node excluded
    c4 = next(n for n in nodes if n["path"] == ["d4", "d5", "c4"])
    assert {"e7e6", "d5c4"} <= c4["covered"]  # covered = opponent replies, as uci


def test_opponent_reply_nodes_black_includes_root_excludes_frontier():
    rep = build_repertoire(["e4 c5 Nf3 d6", "d4 Nf6"], color=chess.BLACK)
    nodes = repertoire.opponent_reply_nodes(rep)
    paths = [n["path"] for n in nodes]
    assert [] in paths  # root: White (opponent) to move with prepared first moves
    root = next(n for n in nodes if n["path"] == [])
    assert {"e2e4", "d2d4"} <= root["covered"]
    assert ["e4", "c5", "Nf3", "d6"] not in paths  # frontier leaf (no replies) excluded


# ---------------------------------------------------------------------------
# Coverage report (get_repertoire_coverage engine-free)
# ---------------------------------------------------------------------------


def test_coverage_flags_dangling_line():
    # e6 ends on White's move (player owes a reply) → dangling; dxc4 e3 ends on Black → frontier.
    rep = build_repertoire(["d4 d5 c4 e6", "d4 d5 c4 dxc4 e3"])
    cov = repertoire.coverage_report(rep, limit=20)
    assert cov["leaves"] == 2
    assert cov["dangling_count"] == 1 and cov["frontier_count"] == 1
    assert cov["dangling_count"] + cov["frontier_count"] == cov["leaves"]
    assert cov["dangling_lines"][0]["path"] == ["d4", "d5", "c4", "e6"]
    assert cov["dangling_lines"][0]["ply"] == 4
    assert cov["max_depth"] == 5 and cov["shallowest_leaf_ply"] == 4


def test_coverage_no_dangling_when_all_frontier():
    # both lines end on White's move → opponent to move at every leaf → no holes
    rep = build_repertoire(["e4", "d4"])
    cov = repertoire.coverage_report(rep, limit=20)
    assert cov["dangling_count"] == 0 and cov["frontier_count"] == 2


def test_coverage_limit_caps_dangling_list():
    rep = build_repertoire(
        ["d4 d5 c4 e6", "d4 Nf6 c4 e6", "g3 d5 Bg2 e6"]
    )  # 3 dangling
    cov = repertoire.coverage_report(rep, limit=1)
    assert cov["dangling_count"] == 3 and len(cov["dangling_lines"]) == 1


def test_coverage_excludes_transposition_stub_from_dangling():
    # Issue #15: the c4-first stub (White to move at its leaf) reaches the same position as
    # the d4-first line's internal node, which continues — so it is covered by transposition,
    # not a real hole. It must be excluded from dangling (mirrors the gap tool's #3 dedup).
    rep = build_repertoire(["d4 Nf6 c4 e6 Nc3", "c4 e6 d4 Nf6"])
    cov = repertoire.coverage_report(rep, limit=20)
    assert cov["dangling_count"] == 0
    assert all(p["path"] != ["c4", "e6", "d4", "Nf6"] for p in cov["dangling_lines"])


def test_coverage_genuine_dangling_still_flagged_with_transpositions():
    # A real hole (no other move order continues from its position) is still flagged even
    # when the tree contains transpositions elsewhere.
    rep = build_repertoire(["d4 Nf6 c4 e6 Nc3", "c4 e6 d4 Nf6", "d4 d5 c4 dxc4"])
    cov = repertoire.coverage_report(rep, limit=20)
    paths = [p["path"] for p in cov["dangling_lines"]]
    assert ["d4", "d5", "c4", "dxc4"] in paths  # White to move, never continued elsewhere


# ---------------------------------------------------------------------------
# ECO opening lookup
# ---------------------------------------------------------------------------


def test_opening_identify_known_position():
    b = chess.Board()
    for s in ("e4", "c5"):
        b.push_san(s)
    op = openings.identify(b)
    assert op is not None and op["eco"].startswith("B") and "Sicilian" in op["name"]


def test_opening_identify_unknown_position():
    assert openings.identify(chess.Board("8/8/4k3/8/8/4K3/8/8 w - - 0 1")) is None


def test_opening_deepest_in_line():
    game = chess.pgn.read_game(io.StringIO("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *"))
    op = openings.deepest_in_line(game)
    assert op is not None and "Ruy Lopez" in op["name"] and op["ply"] >= 5


def test_opening_deepest_to_node_reads_named_ancestor():
    # Issue #17: a deep repertoire leaf is beyond ECO-table depth, so a single-position
    # lookup on the leaf misses — its opening identity comes from the deepest named ancestor.
    rep = build_repertoire(
        ["d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7 e3 O-O Bd3 Nbd7 Nf3 Re8"]
    )
    leaf = next(repertoire.walk_leaves(rep.game))
    assert openings.identify(leaf.board()) is None  # leaf itself is too deep to match
    op = openings.deepest_to_node(leaf)
    assert op is not None and op["eco"].startswith("D")  # QGD family, named at an ancestor
    assert op["ply"] < leaf.ply()  # the name comes from a shallower ancestor


# ---------------------------------------------------------------------------
# Congruence — theme-based outlier fallback (issue #5)
# ---------------------------------------------------------------------------

# Two lines with fianchetto + one without, all positions classify as unknown.
# g3+Bg2 setup for White, simple pawn-only leaf.
LINE_FIANCHETTO_A = (
    "g3 d5 Bg2 c5 c4 Nc6 Nc3 g6"  # white fianchetto + c4 (structure: unknown)
)
LINE_FIANCHETTO_B = (
    "g3 d5 Bg2 Nf6 c4 e6 Nc3 Be7"  # white fianchetto + c4 (structure: unknown)
)
LINE_NO_FIANCHETTO = (
    "g3 d5 c4 Nc6 Nc3 e5 d3 Nf6"  # g3 but no Bg2 → no fianchetto (same opening as A/B)
)


def test_theme_fallback_flags_non_fianchetto_outlier():
    # Two fianchetto lines + one e4 line: all unknown structures.
    # Theme fallback detects fianchetto_white as dominant (2/3 >= 50%) and flags the e4 leaf.
    rep = build_repertoire([LINE_FIANCHETTO_A, LINE_FIANCHETTO_B, LINE_NO_FIANCHETTO])
    result = repertoire.analyze_congruence(rep, "low", 10)
    outliers = [i for i in result["incongruencies"] if i["type"] == "structure_outlier"]
    assert len(outliers) == 1
    assert outliers[0].get("source") == "theme"
    assert "fianchetto_white" in outliers[0]["description"]


def test_theme_fallback_no_flag_when_no_dominant_theme():
    # Three completely different unknown lines, no dominant theme.
    rep = build_repertoire([LINE_NO_FIANCHETTO, LINE_DOUBLED, LINE_OPEN])
    result = repertoire.analyze_congruence(rep, "low", 10)
    outliers = [i for i in result["incongruencies"] if i["type"] == "structure_outlier"]
    assert len(outliers) == 0  # no dominant theme → no flag


def test_named_structure_check_takes_priority_over_theme_fallback():
    # When known_share >= 0.5, named-structure logic runs (no "source":"theme" field).
    rep = build_repertoire([LINE_CARLSBAD, LINE_IQP])  # one opening, both known
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert any(i["type"] == "structure_outlier" for i in result["incongruencies"])
    for item in result["incongruencies"]:
        assert item.get("source") != "theme"


# ---------------------------------------------------------------------------
# Congruence — acknowledged_weaknesses (issue #4)
# ---------------------------------------------------------------------------


def test_congruence_acknowledged_weakness_downgrades_to_low():
    rep = build_repertoire([LINE_CARLSBAD, LINE_QGD_CLEAN, LINE_DOUBLED])
    # Without acknowledgement: weakness_inconsistency fires at severity medium
    unacked = repertoire.analyze_congruence(rep, "low", 10)
    weak_item = next(
        (i for i in unacked["incongruencies"] if i["type"] == "weakness_inconsistency"),
        None,
    )
    assert weak_item is not None and weak_item["severity"] == "medium"

    # With the weak path acknowledged: severity drops to low, acknowledged:true set
    weak_path = weak_item["paths"][0]
    acked = repertoire.analyze_congruence(
        rep, "low", 10, acknowledged_weaknesses=[weak_path]
    )
    acked_item = next(
        i for i in acked["incongruencies"] if i["type"] == "weakness_inconsistency"
    )
    assert acked_item["severity"] == "low"
    assert acked_item.get("acknowledged") is True


def test_congruence_acknowledged_weakness_filtered_by_min_severity():
    rep = build_repertoire([LINE_CARLSBAD, LINE_QGD_CLEAN, LINE_DOUBLED])
    weak_item = next(
        i
        for i in repertoire.analyze_congruence(rep, "low", 10)["incongruencies"]
        if i["type"] == "weakness_inconsistency"
    )
    weak_path = weak_item["paths"][0]
    # acknowledged → severity low; min_severity=medium → filtered out entirely
    result = repertoire.analyze_congruence(
        rep, "medium", 10, acknowledged_weaknesses=[weak_path]
    )
    assert all(i["type"] != "weakness_inconsistency" for i in result["incongruencies"])


def test_congruence_acknowledged_count_field():
    # acknowledged_count present; total_flagged excludes acknowledged items (Issue #10).
    rep = build_repertoire([LINE_CARLSBAD, LINE_QGD_CLEAN, LINE_DOUBLED])
    unacked = repertoire.analyze_congruence(rep, "low", 10)
    weak_path = next(
        i for i in unacked["incongruencies"] if i["type"] == "weakness_inconsistency"
    )["paths"][0]

    acked = repertoire.analyze_congruence(
        rep, "low", 10, acknowledged_weaknesses=[weak_path]
    )
    assert "acknowledged_count" in acked
    assert acked["acknowledged_count"] == 1
    assert acked["total_flagged"] == unacked["total_flagged"] - 1


def test_theme_fallback_skips_transposition_stubs():
    # A short stub ending at a transposition endpoint lacks the dominant theme only
    # because the line is intentionally short — it must NOT be flagged (Issue #9).
    #
    # c4 e5 Nc3 Nc6 g3 g6 Bg2  — fianchetto leaf (fianchetto_white: True)
    # c4 Nf6 g3 g6 Bg2 d5      — fianchetto leaf (fianchetto_white: True)
    # c4 Nc6 Nc3 e5             — 4-ply stub; same FEN at move 4 as first line's
    #                             internal node after c4 e5 Nc3 Nc6 → transposition
    rep = build_repertoire(
        [
            "c4 e5 Nc3 Nc6 g3 g6 Bg2",
            "c4 Nf6 g3 g6 Bg2 d5",
            "c4 Nc6 Nc3 e5",
        ]
    )
    result = repertoire.analyze_congruence(rep, "low", 10)
    outlier_paths = [
        tuple(i["paths"][0])
        for i in result["incongruencies"]
        if i["type"] == "structure_outlier"
    ]
    stub_path = ("c4", "Nc6", "Nc3", "e5")
    assert stub_path not in outlier_paths, (
        "transposition stub must not be flagged as outlier"
    )


# ---------------------------------------------------------------------------
# Transposition-aware opponent_reply_nodes (issue #3)
# ---------------------------------------------------------------------------


def test_opponent_reply_nodes_merges_covered_for_transpositions():
    # Two paths reach the same Black-to-move position: d4 Nf6 c4 and c4 Nf6 d4.
    # One path covers e6, the other covers g6. Merged, both are in covered.
    rep = build_repertoire(["d4 Nf6 c4 e6 Nc3", "c4 Nf6 d4 g6 Nc3"], color=chess.WHITE)
    nodes = repertoire.opponent_reply_nodes(rep)
    # Find the node where Black played Nf6 and White has c4+d4 (Black to move after c4+d4)
    transposed = [n for n in nodes if len(n["transposition_paths"]) > 1]
    assert len(transposed) >= 1
    merged = transposed[0]
    # Both e6 and g6 (Black replies) should be in the merged covered set
    assert len(merged["covered"]) >= 2


def test_opponent_reply_nodes_no_transpositions_has_single_path():
    rep = build_repertoire(["d4 d5 c4 e6 Nc3 Nf6"])
    nodes = repertoire.opponent_reply_nodes(rep)
    for n in nodes:
        assert len(n["transposition_paths"]) == 1
