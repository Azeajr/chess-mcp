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
# Classifier
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fen,expected", [
    (IQP_FEN, "IQP"),
    (CARLSBAD_FEN, "Carlsbad"),
    (MAROCZY_FEN, "Maroczy"),
    (FRENCH_FEN, "French"),
    (STONEWALL_FEN, "Stonewall"),
    (KID_FEN, "King's Indian"),
    (BENONI_FEN, "Benoni"),
    (chess.STARTING_FEN, "unknown"),
    ("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "unknown"),  # 1.e4 e5
])
def test_classify_structure(fen, expected):
    assert structure.classify_structure(chess.Board(fen))["structure_class"] == expected


@pytest.mark.parametrize("fen", [IQP_FEN, CARLSBAD_FEN, MAROCZY_FEN, FRENCH_FEN, STONEWALL_FEN, KID_FEN, BENONI_FEN])
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
    repertoire.store_repertoire(chess.pgn.read_game(io.StringIO(SAMPLE_PGN)), chess.WHITE)
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
    assert repertoire.get_repertoire(ids[0]) is None      # oldest evicted
    assert repertoire.get_repertoire(ids[2]) is not None   # newest retained


# ---------------------------------------------------------------------------
# Aggregate profile & congruence
# ---------------------------------------------------------------------------

def _make_rep(pgn: str) -> repertoire._Repertoire:
    game = chess.pgn.read_game(io.StringIO(pgn))
    now = time.time()
    return repertoire._Repertoire(
        game=game, color=chess.WHITE, created=now, touched=now,
        nodes=0, leaves=0, max_depth=0,
    )


def test_aggregate_profile_shape():
    rep = _make_rep(SAMPLE_PGN)
    agg = repertoire.aggregate_profile(rep)
    assert agg["leaves_analyzed"] == len(list(repertoire.walk_leaves(rep.game)))
    for key in ("structures", "center_distribution", "common_open_files", "common_half_open_files"):
        assert key in agg


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

LINE_CARLSBAD = "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7"          # Carlsbad, locked center
LINE_MAROCZY = "c4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 e4"                # Maroczy
LINE_IQP = "d4 d5 c4 e6 Nc3 c5 cxd5 exd5 dxc5"                   # White IQP
LINE_DOUBLED = "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 Bxc3 bxc3"       # White doubled c-pawns (unknown)
LINE_OPEN = "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nc3 Bb4 Nxc6 dxc6"  # open center (unknown)


def _line_moves(sans: str) -> list[chess.Move]:
    b = chess.Board()
    return [b.push_san(s) for s in sans.split()]


def build_repertoire(lines: list[str], color: chess.Color = chess.WHITE) -> repertoire._Repertoire:
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
    rep = build_repertoire([LINE_CARLSBAD, LINE_MAROCZY])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("structure_outlier") == 1
    item = next(i for i in result["incongruencies"] if i["type"] == "structure_outlier")
    assert item["paths"] and item["severity"] in ("medium", "high")


def test_congruence_flags_weakness_inconsistency():
    rep = build_repertoire([LINE_CARLSBAD, LINE_MAROCZY, LINE_DOUBLED])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("weakness_inconsistency") == 1


def test_congruence_flags_center_inconsistency():
    rep = build_repertoire([LINE_CARLSBAD, LINE_OPEN])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("center_inconsistency") == 1


def test_congruence_no_dominant_structure_flags_no_outlier():
    # three distinct known structures, none >= 50% → structure_outlier must NOT fire
    rep = build_repertoire([LINE_CARLSBAD, LINE_MAROCZY, LINE_IQP])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("structure_outlier") is None


def test_congruence_all_unknown_flags_nothing():
    # both leaves classify unknown → the structure_outlier block is skipped entirely
    rep = build_repertoire([LINE_OPEN, LINE_DOUBLED])
    result = repertoire.analyze_congruence(rep, "low", 10)
    assert result["by_type"].get("structure_outlier") is None


def test_congruence_min_severity_filters():
    rep = build_repertoire([LINE_CARLSBAD, LINE_MAROCZY])  # outlier here is 'medium'
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
    b = pawns((chess.E4, False), (chess.D3, True))  # white d3 is ahead+adjacent for Black
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
    b = pawns((chess.D5, False), (chess.A2, True))  # Black d5 isolani, White has no d-pawn
    assert structure._iqp_confidence(b, chess.BLACK) == 0.9


def test_iqp_rejected_when_opponent_has_d_pawn():
    b = pawns((chess.D4, True), (chess.D7, False))  # White d4 isolani but Black still has d7
    assert structure._iqp_confidence(b, chess.WHITE) == 0.0


def test_iqp_advanced_rank_scores_lower():
    b = pawns((chess.D5, True), (chess.A7, False))  # White d5 (advanced, not the classic d4)
    assert structure._iqp_confidence(b, chess.WHITE) == 0.6


def test_carlsbad_rejected_when_owner_keeps_c_pawn():
    b = pawns((chess.D4, True), (chess.C2, True), (chess.D5, False), (chess.C6, False))
    assert structure._carlsbad_confidence(b) == 0.0  # White still has a c-pawn → not Carlsbad


def test_maroczy_mirrored_black_binds():
    b = pawns((chess.C5, False), (chess.E5, False), (chess.A2, True))  # Black c5+e5, no d-pawn
    assert structure._maroczy_confidence(b) == 0.7


def test_carlsbad_mirrored_black_half_open_c():
    # Black d5 + half-open c-file; White d4, keeps c-pawn, no e-pawn → mirrored Carlsbad.
    b = pawns((chess.D5, False), (chess.D4, True), (chess.C2, True))
    assert structure._carlsbad_confidence(b) == 0.7


def test_center_semi_open():
    b = pawns((chess.D4, True), (chess.E6, False))  # central pawns, no contact, not locked
    assert structure.center_state(b) == "semi-open"


# ---------------------------------------------------------------------------
# Walker edge cases.
# ---------------------------------------------------------------------------

def test_resolve_path_illegal_san_returns_none(sample_game):
    assert repertoire.resolve_path(sample_game, ["Zz9"]) is None


def test_resolve_path_empty_returns_root(sample_game):
    assert repertoire.resolve_path(sample_game, []) is sample_game
