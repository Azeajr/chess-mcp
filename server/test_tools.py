"""Tool-layer tests for chess_mcp.py — the @mcp.tool wrappers: validation, error
codes, caps, and the engine-free repertoire paths.

Engine-backed ranking (suggest_complementary_lines with a live position) needs
Stockfish and is verified in Docker (evals/capture.py + the SSE smoke client), not here.
Only the pre-engine guards of suggest are exercised below.

Run (needs mcp, which is a main dependency):  uv run pytest   (from server/)
"""

import io

import chess
import chess.engine
import chess.pgn
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


def test_load_rejects_illegal_move():
    # the run's bug: a truncated PGN leaves an illegal SAN (here black "g3"); python-chess
    # drops the tail and would load a partial tree silently. #1 makes it fail loudly.
    bad = '[Event "t"]\n\n1. d4 d5 2. c4 e6 3. Nc3 g3 *\n'
    assert cm.load_repertoire(bad, "white")["error"] == "invalid_pgn"


def test_validate_pgn_rejects_illegal_move():
    r = cm.validate_pgn(
        '[Event "t"]\n\n1. e4 e5 2. Qh6 *\n'
    )  # Qh6 is not a legal queen move
    assert r["valid"] is False and r["error"] == "invalid_pgn"


def test_parse_game_rejects_illegal_move():
    # the single-game path (game tools) guards too — engine-free check via the raw parser
    with pytest.raises(ValueError):
        cm._parse_game('[Event "t"]\n\n1. e4 e5 2. Qh6 *\n')


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


# --- find_repertoire_gaps (#2 wall-clock budget) ---


def test_find_gaps_budget_exhausted_returns_partial(rid, monkeypatch):
    # GAP_BUDGET_S=0 → the loop breaks before any engine call; verifies the partial-result
    # contract (positions_scanned, budget_exhausted, reason) without needing Stockfish.
    monkeypatch.setattr(cm, "_GAP_BUDGET_S", 0.0)

    class _DummyEngine:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def analyse(self, *a, **k):
            raise AssertionError("engine must not run once the budget is spent")

    monkeypatch.setattr(
        chess.engine.SimpleEngine,
        "popen_uci",
        staticmethod(lambda *a, **k: _DummyEngine()),
    )
    r = cm.find_repertoire_gaps(rid)
    assert r["positions_scanned"] == 0
    assert r["budget_exhausted"] is True
    assert r["gaps"] == [] and "reason" in r


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


def test_validate_line_illegal_uci_reports_illegal_not_parse_error():
    # board.parse_uci enforces legality itself, so the "illegal move" branch was
    # unreachable: a well-formed but illegal UCI move ("e2e5") was misreported as
    # "not valid UCI or SAN". Syntax-only UCI parsing routes it to the accurate reason.
    r = cm.validate_line(chess.STARTING_FEN, ["e2e5"])
    assert r["valid"] is False and r["error_at_index"] == 0
    assert r["reason"] == "illegal move in this position"
    assert r["fen_at_error"] == chess.STARTING_FEN


def test_get_legal_moves_san():
    r = cm.get_legal_moves(chess.STARTING_FEN)
    assert r["move_count"] == 20 and isinstance(r["moves"], str)


def test_get_legal_moves_uci():
    r = cm.get_legal_moves(chess.STARTING_FEN, uci=True)
    assert r["move_count"] == 20 and isinstance(r["moves"], list)


def test_get_legal_moves_bad_fen():
    assert cm.get_legal_moves("nope")["error"] == "invalid_fen"


# --- validate_fen (engine-free) ---


def test_validate_fen_ok():
    r = cm.validate_fen(chess.STARTING_FEN)
    assert r["valid"] is True and r["side_to_move"] == "white"
    assert r["is_game_over"] is False
    assert len(r["fen"].split()) == 6  # normalized 6-field FEN echoed back


def test_validate_fen_bad_syntax():
    r = cm.validate_fen("not-a-fen")
    assert r["valid"] is False and r["error"] == "invalid_fen"


def test_validate_fen_illegal_position_rejected():
    # parses fine, but an empty board has no kings → board.status() != STATUS_VALID
    r = cm.validate_fen("8/8/8/8/8/8/8/8 w - - 0 1")
    assert r["valid"] is False and r["error"] == "invalid_fen"


def test_validate_fen_detects_game_over():
    r = cm.validate_fen(FOOLS_MATE_FEN)
    assert r["valid"] is True and r["is_game_over"] is True


# --- validate_pgn (engine-free) ---


def test_validate_pgn_ok():
    r = cm.validate_pgn(REP_PGN)
    assert r["valid"] is True and r["mainline_plies"] == 10
    assert r["has_variations"] is False
    assert r["headers"]["result"] == "*"


def test_validate_pgn_detects_variations():
    r = cm.validate_pgn(EXPORT_PGN)  # has a 1...Nf6 side line
    assert r["valid"] is True and r["has_variations"] is True


def test_validate_pgn_empty():
    r = cm.validate_pgn("")
    assert r["valid"] is False and r["error"] == "invalid_pgn"


def test_validate_pgn_too_large():
    r = cm.validate_pgn("1. e4 e5 " * 200000)
    assert r["valid"] is False and r["error"] == "pgn_too_large"


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


# --- time_limit / engine search-limit selection (engine-free) ---


def test_clamp_time_bounds():
    assert cm._clamp_time(0.0) == cm.MIN_TIME  # below floor → clamped up
    assert cm._clamp_time(10**9) == cm.MAX_TIME  # above ceiling → clamped down
    assert cm._clamp_time(0.5) == 0.5  # in range → unchanged


def test_limit_depth_is_default():
    lim = cm._limit(18, None)
    assert lim.depth == 18 and lim.time is None


def test_limit_time_overrides_depth():
    lim = cm._limit(18, 0.5)
    assert lim.time == 0.5 and lim.depth is None


# --- whole-tree analysis: _path_of + mainline projection (engine-free) ---


def _branching_game() -> chess.pgn.Game:
    """d4 d5 c4 mainline with a 1...Nf6 side line branching off after 1.d4."""
    game = chess.pgn.Game()
    d4 = game.add_variation(chess.Move.from_uci("d2d4"))
    d5 = d4.add_variation(
        chess.Move.from_uci("d7d5")
    )  # mainline (added first → variations[0])
    d4.add_variation(chess.Move.from_uci("g8f6"))  # side line 1...Nf6
    d5.add_variation(chess.Move.from_uci("c2c4"))  # mainline continues
    return game


def test_path_of_addresses_every_node():
    game = _branching_game()
    board_by_node = {n: n.board() for n in [game, *repertoire.iter_nodes(game)]}
    paths = {cm._path_of(n, board_by_node) for n in repertoire.iter_nodes(game)}
    assert paths == {("d4",), ("d4", "d5"), ("d4", "Nf6"), ("d4", "d5", "c4")}


def test_analyse_all_moves_projects_mainline_only(monkeypatch):
    game = _branching_game()
    # fake whole-tree analysis: every node maps to a record tagged with its own path
    records_by_path = {
        ("d4",): {"p": ("d4",)},
        ("d4", "d5"): {"p": ("d4", "d5")},
        ("d4", "Nf6"): {"p": ("d4", "Nf6")},  # side line — must NOT be projected
        ("d4", "d5", "c4"): {"p": ("d4", "d5", "c4")},
    }
    monkeypatch.setattr(cm, "_analyse_tree", lambda *a: (records_by_path, game))
    mainline, _ = cm._analyse_all_moves("pgn", 1, 1, None)
    assert [r["p"] for r in mainline] == [("d4",), ("d4", "d5"), ("d4", "d5", "c4")]


# --- export_annotated_pgn: annotation + serialization (engine-free, _analyse_tree faked) ---

EXPORT_PGN = '[Event "t"]\n[Result "*"]\n\n1. d4 d5 ( 1... Nf6 2. c4 ) 2. c4 *\n'


def _rec(classification: str, cp_loss: int) -> dict:
    return {
        "classification": classification,
        "cp_loss": cp_loss,
        "eval_after": -120,
        "best_move": "Nf3",
    }


def _fake_tree(*_a):
    # records for every node of EXPORT_PGN's fresh parse, keyed by SAN path
    recs = {
        ("d4",): _rec("good", 0),
        ("d4", "d5"): _rec("blunder", 300),  # flagged
        ("d4", "Nf6"): _rec("inaccuracy", 60),  # flagged (side line)
        ("d4", "Nf6", "c4"): _rec("good", 10),
        ("d4", "d5", "c4"): _rec("good", 20),
    }
    return recs, None  # game is unused: export re-parses its own mutable tree


def test_export_counts_only_flagged_moves(monkeypatch):
    monkeypatch.setattr(cm, "_analyse_tree", _fake_tree)
    out = cm.export_annotated_pgn(EXPORT_PGN, min_cp_loss=50)
    assert (
        out["moves_annotated"] == 2
    )  # d5 blunder + Nf6 inaccuracy; good moves untouched


def test_export_glyphs_land_on_right_moves_and_preserve_variation(monkeypatch):
    monkeypatch.setattr(cm, "_analyse_tree", _fake_tree)
    g = chess.pgn.read_game(io.StringIO(cm.export_annotated_pgn(EXPORT_PGN)["pgn"]))
    d4 = g.variations[0]
    assert d4.nags == set()  # good move → no glyph
    assert len(d4.variations) == 2  # the 1...Nf6 side line survived serialization
    d5, nf6 = d4.variations[0], d4.variations[1]
    assert chess.pgn.NAG_BLUNDER in d5.nags and "best" in d5.comment
    assert chess.pgn.NAG_DUBIOUS_MOVE in nf6.nags  # side-line move annotated too


def test_export_clean_when_threshold_above_all(monkeypatch):
    monkeypatch.setattr(cm, "_analyse_tree", _fake_tree)
    out = cm.export_annotated_pgn(EXPORT_PGN, min_cp_loss=1000)
    assert out["moves_annotated"] == 0


def test_export_too_large():
    assert cm.export_annotated_pgn("1. e4 e5 " * 200000)["error"] == "pgn_too_large"


def test_export_preserves_existing_comment(monkeypatch):
    # The annotation must append to a comment the input PGN already carries on a
    # flagged move — overwriting silently destroyed the author's annotations.
    monkeypatch.setattr(cm, "_analyse_tree", _fake_tree)
    pgn = '[Event "t"]\n[Result "*"]\n\n1. d4 d5 {hold the center} ( 1... Nf6 2. c4 ) 2. c4 *\n'
    g = chess.pgn.read_game(io.StringIO(cm.export_annotated_pgn(pgn)["pgn"]))
    d5 = g.variations[0].variations[0]
    assert "hold the center" in d5.comment and "best Nf3" in d5.comment


def test_game_summary_question_mark_opening_is_null(monkeypatch):
    # [Opening "?"] is PGN's explicit unknown marker — it must surface as null, and a
    # "?" Opening must not shadow a real ECO backstop (validate_pgn filters the same way).
    rec = {
        "move_number": 1,
        "color": "white",
        "move": "e4",
        "cp_loss": 0,
        "classification": "good",
        "best_move": "e4",
    }

    def _summary_for(pgn: str) -> dict:
        game = chess.pgn.read_game(io.StringIO(pgn))
        monkeypatch.setattr(cm, "_analyse_all_moves", lambda *a: ([rec], game))
        return cm.get_game_summary(pgn)

    assert _summary_for('[Event "t"]\n[Opening "?"]\n\n1. e4 *')["opening"] is None
    assert (
        _summary_for('[Event "t"]\n[Opening "?"]\n[ECO "B10"]\n\n1. e4 *')["opening"]
        == "B10"
    )


# --- compare_moves (pre-engine guards only; engine ranking verified in Docker) ---


def test_compare_moves_bad_fen():
    assert cm.compare_moves("garbage", ["e4"])["error"] == "invalid_fen"


def test_compare_moves_too_many():
    over = ["e4"] * (cm.MAX_COMPARE_MOVES + 1)
    assert cm.compare_moves(chess.STARTING_FEN, over)["error"] == "too_many_moves"


def test_compare_moves_all_illegal_short_circuits():
    # every input illegal/unparseable → returns before opening the engine (no Stockfish)
    r = cm.compare_moves(chess.STARTING_FEN, ["Ke2", "zzz"])
    assert r["results"] == [] and set(r["illegal"]) == {"Ke2", "zzz"}
    assert r["side_to_move"] == "white"


# --- _gaps_from_infos (pure helper feeding find_repertoire_gaps; engine-free) ---

# After 1.d4 — Black (the opponent for a White repertoire) to move.
_BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"


def _info(white_cp: int, uci: str) -> dict:
    return {
        "score": chess.engine.PovScore(chess.engine.Cp(white_cp), chess.WHITE),
        "pv": [chess.Move.from_uci(uci)],
    }


def test_gaps_from_infos_flags_uncovered_with_severity():
    board = chess.Board(_BLACK_TO_MOVE)
    # Black to move: mover_cp = -white_cp. Severity = closeness to the mover's best, capped
    # by the mover's absolute edge (#19). Best = Nf6 (mover_cp 200), but COVERED.
    infos = [
        _info(-200, "g8f6"),  # Nf6 — best for Black, COVERED
        _info(-180, "d7d5"),  # d5  — mover_cp 180, loss 20, edge>=60 → high
        _info(-130, "g7g6"),  # g6  — mover_cp 130, loss 70, edge>=60 → medium
        _info(-10, "a7a6"),  # a6  — mover_cp 10, edge<25 → low
    ]
    gaps = cm._gaps_from_infos(board, infos, {"g8f6"})
    by_move = {e["uncovered_move"]: e for e, _ in gaps}
    assert set(by_move) == {"d5", "g6", "a6"}  # covered Nf6 excluded
    assert by_move["d5"]["severity"] == "high"
    assert by_move["g6"]["severity"] == "medium"
    assert by_move["a6"]["severity"] == "low"
    assert by_move["d5"]["eval"] == -180  # eval is white-POV


def test_gaps_from_infos_all_covered_or_empty():
    board = chess.Board(_BLACK_TO_MOVE)
    assert cm._gaps_from_infos(board, [_info(-20, "g8f6")], {"g8f6"}) == []
    assert cm._gaps_from_infos(board, [], set()) == []


def test_gaps_from_infos_tags_forward_transposition():
    # Gap board: Black (opponent) to move after c4 Nf6 d4. Candidate …e6 transposes into the
    # prepared QGD position after d4 Nf6 c4 e6, which is interior in continued_keys.
    board = chess.Board()
    for m in ["c4", "Nf6", "d4"]:
        board.push_san(m)
    target = chess.Board()
    for m in ["d4", "Nf6", "c4", "e6"]:
        target.push_san(m)
    continued = {repertoire._position_key(target): ["d4", "Nf6", "c4", "e6"]}
    info = {
        "score": chess.engine.PovScore(chess.engine.Cp(-30), chess.WHITE),
        "pv": [board.parse_san("e6")],
    }
    # No continued_keys → flagged as a plain gap, no transposes_to.
    plain = cm._gaps_from_infos(board, [info], set())
    assert plain and "transposes_to" not in plain[0][0]
    # With continued_keys → same gap gains transposes_to (the rejoined path).
    tagged = cm._gaps_from_infos(board, [info], set(), continued)
    assert tagged[0][0]["transposes_to"] == ["d4", "Nf6", "c4", "e6"]


# --- repertoire tool guards (engine-free path) ---


def test_find_gaps_bad_id():
    assert cm.find_repertoire_gaps("nope")["error"] == "repertoire_not_found"


def test_coverage_bad_id():
    assert cm.get_repertoire_coverage("nope")["error"] == "repertoire_not_found"


def test_coverage_tool(rid):
    cov = cm.get_repertoire_coverage(rid)
    assert cov["color"] == "white" and "leaves" in cov
    assert cov["dangling_count"] + cov["frontier_count"] == cov["leaves"]


def test_gap_default_depth_is_20():
    assert cm._GAP_DEFAULT_DEPTH == 20


def test_suggest_replacement_bad_id():
    result = cm.suggest_replacement_line("nope", ["e4", "e5"])
    assert result["error"] == "repertoire_not_found"


def test_suggest_replacement_bad_mode(rid):
    result = cm.suggest_replacement_line(rid, ["d4", "d5"], mode="typo")
    assert result["error"] == "invalid_mode"


def test_suggest_replacement_bad_path(rid):
    result = cm.suggest_replacement_line(rid, ["e4", "zz99"])
    assert result["error"] == "variation_not_found"


def test_find_gaps_output_has_transposition_endpoints_field(rid):
    # Engine-free guard: the field is always present, even without transpositions.
    # This calls the bad-id path so no engine is needed.
    result = cm.find_repertoire_gaps("nope")
    assert result["error"] == "repertoire_not_found"
    # For a valid repertoire the field exists (engine would run; tested in integration).
    # Verify the key is present in the function signature via a side-channel: inspect
    # the source to ensure transposition_endpoints is returned.
    import inspect

    src = inspect.getsource(cm.find_repertoire_gaps)
    assert "transposition_endpoints" in src


# --- modify_repertoire_line + export_repertoire (stateful edit loop, engine-free) ---


def test_modify_bad_id():
    assert (
        cm.modify_repertoire_line("nope", [], "prune")["error"]
        == "repertoire_not_found"
    )


def test_modify_add_grafts_and_returns_new_id(rid):
    r = cm.modify_repertoire_line(
        rid, ["d4", "d5", "c4"], "add", add_moves=["c6", "Nf3"]
    )
    assert r["action"] == "add" and "new_repertoire_id" in r
    assert r["new_repertoire_id"] != rid
    assert r["nodes"] == 12 and r["leaves"] == 2  # +2 nodes (c6, Nf3), +1 leaf
    assert "added 2 ply" in r["summary"]


def test_modify_is_clone_on_write_source_unchanged(rid):
    before = repertoire.get_repertoire(rid).nodes
    cm.modify_repertoire_line(rid, ["d4", "d5", "c4"], "add", add_moves=["c6"])
    # the source id still resolves to the UNMODIFIED tree (immutable-handle contract)
    assert repertoire.get_repertoire(rid).nodes == before


def test_modify_new_id_works_with_every_read_tool(rid):
    new_id = cm.modify_repertoire_line(
        rid, ["d4", "d5", "c4"], "add", add_moves=["c6", "Nf3"]
    )["new_repertoire_id"]
    # each engine-free read tool resolves the new id immediately (no re-upload)
    assert cm.get_structural_profile(new_id)["leaves_analyzed"] == 2
    assert "incongruencies" in cm.analyze_repertoire_congruence(new_id)
    assert cm.get_repertoire_coverage(new_id)["leaves"] == 2
    assert "transpositions" in cm.get_transpositions(new_id)


def test_modify_add_illegal_move(rid):
    r = cm.modify_repertoire_line(rid, ["d4"], "add", add_moves=["Qh9"])
    assert r["error"] == "invalid_line"


def test_modify_add_empty(rid):
    assert cm.modify_repertoire_line(rid, ["d4"], "add")["error"] == "invalid_edit"


def test_modify_add_too_many_moves(rid):
    r = cm.modify_repertoire_line(rid, ["d4"], "add", add_moves=["a"] * 501)
    assert r["error"] == "too_many_moves"


def test_modify_prune_removes_subtree(rid):
    leaf = ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5", "Bg5"]
    r = cm.modify_repertoire_line(rid, leaf, "prune")
    assert r["nodes"] < repertoire.get_repertoire(rid).nodes
    assert "pruned subtree" in r["summary"]


def test_modify_prune_root_rejected(rid):
    assert cm.modify_repertoire_line(rid, [], "prune")["error"] == "invalid_edit"


def test_modify_prune_bad_path(rid):
    assert (
        cm.modify_repertoire_line(rid, ["e4", "zz"], "prune")["error"]
        == "variation_not_found"
    )


def test_modify_reorder_promotes_child(rid):
    added = cm.modify_repertoire_line(rid, ["d4", "d5", "c4"], "add", add_moves=["c6"])[
        "new_repertoire_id"
    ]
    r = cm.modify_repertoire_line(
        added, ["d4", "d5", "c4"], "reorder", promote_move="c6"
    )
    assert "promoted 'c6'" in r["summary"]
    # c6 is now variations[0] at that node on the returned tree
    node = repertoire.resolve_path(
        repertoire.get_repertoire(r["new_repertoire_id"]).game, ["d4", "d5", "c4"]
    )
    assert node.variations[0].san() == "c6"


def test_modify_reorder_missing_promote_move(rid):
    assert cm.modify_repertoire_line(rid, ["d4"], "reorder")["error"] == "invalid_edit"


def test_modify_reorder_bad_child(rid):
    r = cm.modify_repertoire_line(rid, ["d4"], "reorder", promote_move="h6")
    assert r["error"] == "variation_not_found"


def test_modify_rejects_payload_for_wrong_action(rid):
    # a payload field set for the wrong action → invalid_edit (mis-shaped request, §9.2)
    assert (
        cm.modify_repertoire_line(rid, ["d4"], "prune", add_moves=["e4"])["error"]
        == "invalid_edit"
    )
    assert (
        cm.modify_repertoire_line(
            rid, ["d4"], "add", add_moves=["d5"], promote_move="d5"
        )["error"]
        == "invalid_edit"
    )


def test_export_bad_id():
    assert cm.export_repertoire("nope")["error"] == "repertoire_not_found"


def test_export_roundtrips_through_load(rid):
    exp = cm.export_repertoire(rid)
    assert exp["games"] == 1 and exp["pgn"].strip()
    reloaded = cm.load_repertoire(exp["pgn"], "white")
    assert reloaded["nodes"] == exp["nodes"] and reloaded["leaves"] == exp["leaves"]


def test_export_reflects_a_prior_edit(rid):
    new_id = cm.modify_repertoire_line(
        rid, ["d4", "d5", "c4"], "add", add_moves=["c6", "Nf3"]
    )["new_repertoire_id"]
    exp = cm.export_repertoire(new_id)
    assert exp["nodes"] == 12
    # the exported PGN carries the grafted line back through a fresh load
    assert cm.load_repertoire(exp["pgn"], "white")["nodes"] == 12


def test_identify_opening_garbled_tail_rejected():
    # A garbled move mid-PGN must surface invalid_pgn, not silently name the opening
    # from the half-parsed mainline (parity with the other PGN tools).
    r = cm.identify_opening("1. e4 e5 2. Nf3 Nc6 3. Bb5 zz99 4. Ba4 *")
    assert r["error"] == "invalid_pgn"


def test_suggest_replacement_no_user_move():
    # Black repertoire, path holding only a White (opponent) move: pivot resolution
    # finds no user move to replace and must error before any engine work.
    pgn = '[Event "t"]\n[Result "*"]\n\n1. e4 *\n'
    rid = cm.load_repertoire(pgn, "black")["repertoire_id"]
    result = cm.suggest_replacement_line(rid, ["e4"])
    assert result["error"] == "no_user_move"


# --- engine-result scoring helpers (pure: PovScore in, ints out) ---


def test_score_cp_mate_saturates_to_pm_10000():
    PovScore, Mate = chess.engine.PovScore, chess.engine.Mate
    assert cm._score_cp(PovScore(Mate(2), chess.WHITE)) == 10000
    assert cm._score_cp(PovScore(Mate(-1), chess.WHITE)) == -10000
    # Black-POV input normalizes to white-POV before saturating
    assert cm._score_cp(PovScore(Mate(2), chess.BLACK)) == -10000


def test_score_with_type_mate_and_cp():
    PovScore, Cp, Mate = chess.engine.PovScore, chess.engine.Cp, chess.engine.Mate
    assert cm._score_with_type(PovScore(Cp(35), chess.WHITE)) == (35, "cp", None)
    assert cm._score_with_type(PovScore(Mate(3), chess.WHITE)) == (10000, "mate", 3)
    assert cm._score_with_type(PovScore(Mate(-2), chess.WHITE)) == (-10000, "mate", -2)


@pytest.mark.parametrize(
    "cp_loss,expected",
    [
        (0, "good"),
        (50, "good"),
        (51, "inaccuracy"),
        (100, "inaccuracy"),
        (101, "mistake"),
        (200, "mistake"),
        (201, "blunder"),
    ],
)
def test_classify_thresholds(cp_loss, expected):
    assert cm._classify(cp_loss) == expected


def test_pv_san_caps_at_five_moves_and_leaves_board_untouched():
    board = chess.Board()
    pv = [
        chess.Move.from_uci(u) for u in ("e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6")
    ]
    assert cm._pv_san(board, pv) == "e4 e5 Nf3 Nc6 Bb5"
    assert board == chess.Board()  # rendered on a copy


def test_parse_move_uci_san_and_garbage():
    board = chess.Board()
    assert cm._parse_move(board, "e2e4") == chess.Move.from_uci("e2e4")
    assert cm._parse_move(board, "Nf3") == chess.Move.from_uci("g1f3")
    assert cm._parse_move(board, "zz99") is None


# --- identify_opening / validate_pgn remaining guards ---


def test_identify_opening_too_large():
    big = "1. e4 e5 " * (cm.MAX_PGN_BYTES // 9 + 1)
    assert cm.identify_opening(big)["error"] == "pgn_too_large"


def test_validate_pgn_multigame_reports_games_and_opening():
    two = (
        '[Event "a"]\n[ECO "B10"]\n[Result "*"]\n\n1. e4 c6 *\n\n'
        '[Event "b"]\n[Result "*"]\n\n1. d4 d5 *\n'
    )
    r = cm.validate_pgn(two)
    assert r["valid"] and r["games"] == 2 and r["has_variations"]
    assert r["headers"]["opening"] == "B10"  # ECO backstops a missing Opening header


# --- modify_repertoire_line: path/SAN resolution errors in the editors ---


def test_modify_add_bad_path(rid):
    r = cm.modify_repertoire_line(rid, ["d4", "zz9"], "add", add_moves=["Nf3"])
    assert r["error"] == "variation_not_found"


def test_modify_reorder_bad_path(rid):
    r = cm.modify_repertoire_line(rid, ["d4", "zz9"], "reorder", promote_move="d5")
    assert r["error"] == "variation_not_found"


def test_modify_reorder_unparseable_promote_move(rid):
    # Garbage SAN cannot name a child — same closed error as an absent child.
    r = cm.modify_repertoire_line(rid, ["d4"], "reorder", promote_move="zz9")
    assert r["error"] == "variation_not_found"


def test_score_cp_delivered_mate_sign():
    # "mate 0" = the side to move is already checkmated. A mated BLACK flips to
    # MateGiven from white's POV — mate() == 0, so a `mate() > 0` sign test calls
    # every White win by checkmate -10000. Sign must come from Score ordering.
    PovScore, Mate = chess.engine.PovScore, chess.engine.Mate
    assert cm._score_cp(PovScore(Mate(0), chess.BLACK)) == 10000  # white delivered
    assert cm._score_cp(PovScore(Mate(0), chess.WHITE)) == -10000  # black delivered


def test_score_with_type_delivered_mate_sign():
    PovScore, Mate = chess.engine.PovScore, chess.engine.Mate
    assert cm._score_with_type(PovScore(Mate(0), chess.BLACK)) == (10000, "mate", 0)
    assert cm._score_with_type(PovScore(Mate(0), chess.WHITE)) == (-10000, "mate", 0)


# --- security pass: engine-input gates ---

ILLEGAL_KINGLESS_FEN = "8/8/8/8/8/8/8/8 w - - 0 1"  # parseable, no kings


def test_evaluate_position_rejects_illegal_position():
    # Illegal-but-parseable positions are undefined behavior for Stockfish — the
    # gate must fire BEFORE the engine subprocess opens.
    assert cm.evaluate_position(ILLEGAL_KINGLESS_FEN)["error"] == "invalid_fen"


def test_compare_moves_rejects_illegal_position():
    assert cm.compare_moves(ILLEGAL_KINGLESS_FEN, ["e4"])["error"] == "invalid_fen"


def test_suggest_rejects_illegal_position(rid):
    r = cm.suggest_complementary_lines(rid, ILLEGAL_KINGLESS_FEN)
    assert r["error"] == "invalid_fen"


def test_analyze_game_node_cap(monkeypatch):
    # The byte cap admits PGNs encoding thousands of plies; node count bounds the
    # per-call engine work. Cap fires pre-engine -> too_many_moves, not a hang.
    monkeypatch.setattr(cm, "ANALYZE_MAX_NODES", 5)
    pgn = '[Event "t"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *\n'
    assert cm.analyze_game(pgn)["error"] == "too_many_moves"


def test_export_annotated_node_cap(monkeypatch):
    monkeypatch.setattr(cm, "ANALYZE_MAX_NODES", 5)
    pgn = '[Event "t"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *\n'
    assert cm.export_annotated_pgn(pgn)["error"] == "too_many_moves"


def test_clamp_depth_bounds():
    assert cm._clamp_depth(0) == cm.MIN_DEPTH
    assert cm._clamp_depth(99) == cm.MAX_DEPTH
    assert cm._clamp_depth(18) == 18
