"""Tool-layer tests for chess_mcp.py — the @mcp.tool wrappers: validation, error
codes, caps, and the engine-free repertoire paths.

Engine-backed ranking (suggest_complementary_lines with a live position) needs
Stockfish and is verified in Docker (evals/capture.py + the SSE smoke client), not here.
Only the pre-engine guards of suggest are exercised below.

Run (needs mcp, which is a main dependency):  uv run pytest   (from server/)
"""

import chess
import pytest

import chess_mcp as cm
import repertoire

REP_PGN = (
    '[Event "t"]\n[Result "*"]\n\n'
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 Be7 *\n"
)
CARLSBAD_LEAF = ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5", "Bg5", "Be7"]
FOOLS_MATE_FEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"


@pytest.fixture(autouse=True)
def _clear_cache():
    repertoire._CACHE.clear()
    yield
    repertoire._CACHE.clear()


@pytest.fixture
def rid() -> str:
    return cm.load_repertoire(REP_PGN, "white")["repertoire_id"]


# --- load_repertoire ---


def test_load_ok():
    r = cm.load_repertoire(REP_PGN, "white")
    assert r["color"] == "white" and r["nodes"] > 0 and "repertoire_id" in r


def test_load_bad_color():
    assert cm.load_repertoire(REP_PGN, "purple")["error"] == "invalid_color"


def test_load_empty_pgn():
    assert cm.load_repertoire("", "white")["error"] == "invalid_pgn"


def test_load_too_large():
    assert cm.load_repertoire("1. e4 e5 " * 200000, "white")["error"] == "pgn_too_large"


# --- get_structural_profile ---


def test_profile_aggregate(rid):
    agg = cm.get_structural_profile(rid)
    assert "structures" in agg and "leaves_analyzed" in agg


def test_profile_node(rid):
    p = cm.get_structural_profile(rid, CARLSBAD_LEAF)
    assert p["structure_class"] == "Carlsbad" and "fen" in p


def test_profile_bad_id():
    assert cm.get_structural_profile("nope")["error"] == "repertoire_not_found"


def test_profile_bad_path(rid):
    assert (
        cm.get_structural_profile(rid, ["d4", "Qh5"])["error"] == "variation_not_found"
    )


# --- analyze_repertoire_congruence ---


def test_congruence_tool(rid):
    r = cm.analyze_repertoire_congruence(rid)
    assert "total_flagged" in r and isinstance(r["incongruencies"], list)


def test_congruence_bad_id():
    assert cm.analyze_repertoire_congruence("nope")["error"] == "repertoire_not_found"


def test_transpositions_tool(rid):
    r = cm.get_transpositions(rid)
    assert "total" in r and isinstance(r["transpositions"], list)


def test_transpositions_bad_id():
    assert cm.get_transpositions("nope")["error"] == "repertoire_not_found"


def test_congruence_limit_clamped(rid):
    assert (
        len(cm.analyze_repertoire_congruence(rid, "low", 999)["incongruencies"]) <= 50
    )


# --- suggest_complementary_lines (pre-engine guards only) ---


def test_suggest_bad_id():
    assert (
        cm.suggest_complementary_lines("nope", chess.STARTING_FEN)["error"]
        == "repertoire_not_found"
    )


def test_suggest_bad_mode(rid):
    assert (
        cm.suggest_complementary_lines(rid, chess.STARTING_FEN, "wild")["error"]
        == "invalid_mode"
    )


def test_suggest_bad_fen(rid):
    assert cm.suggest_complementary_lines(rid, "not-a-fen")["error"] == "invalid_fen"


def test_suggest_game_over_short_circuits(rid):
    # terminal position returns empty suggestions WITHOUT invoking the engine
    r = cm.suggest_complementary_lines(rid, FOOLS_MATE_FEN)
    assert r["suggestions"] == [] and r["anchor_fen"] == FOOLS_MATE_FEN


# --- original engine-free tools (were untested) ---


def test_validate_line_ok():
    r = cm.validate_line(chess.STARTING_FEN, ["e4", "e5", "Nf3"])
    assert r["valid"] is True and r["moves_validated"] == 3


def test_validate_line_illegal_move():
    r = cm.validate_line(chess.STARTING_FEN, ["e4", "Ke2"])
    assert r["valid"] is False and r["error_at_index"] == 1


def test_validate_line_bad_fen():
    assert cm.validate_line("garbage", ["e4"])["error"] == "invalid_fen"


def test_get_legal_moves_san():
    r = cm.get_legal_moves(chess.STARTING_FEN)
    assert r["move_count"] == 20 and isinstance(r["moves"], str)


def test_get_legal_moves_uci():
    r = cm.get_legal_moves(chess.STARTING_FEN, uci=True)
    assert r["move_count"] == 20 and isinstance(r["moves"], list)


def test_get_legal_moves_bad_fen():
    assert cm.get_legal_moves("nope")["error"] == "invalid_fen"


# --- _move_accuracy (pure helper feeding get_game_summary's accuracy_pct) ---


def test_move_accuracy_perfect_at_zero_loss():
    assert cm._move_accuracy(0) == 1.0


def test_move_accuracy_monotonic_decreasing_and_bounded():
    # worse moves score strictly lower, and accuracy stays within [0, 1]
    a_good, a_inacc, a_blunder = (
        cm._move_accuracy(0),
        cm._move_accuracy(100),
        cm._move_accuracy(500),
    )
    assert 0.0 < a_blunder < a_inacc < a_good == 1.0


def test_move_accuracy_negative_loss_clamped_to_perfect():
    # cp_loss is floored at 0 upstream, but the helper must not exceed 1.0 regardless
    assert cm._move_accuracy(-50) == 1.0


def test_identify_opening_tool():
    r = cm.identify_opening("1. e4 e5 2. Nf3 Nc6 3. Bb5 *")
    assert r.get("eco", "").startswith("C") and "Ruy Lopez" in r.get("name", "")


def test_identify_opening_empty():
    assert cm.identify_opening("")["error"] == "invalid_pgn"
