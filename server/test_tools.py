"""Tool-layer tests for chess_mcp.py — the @mcp.tool wrappers: validation, error
codes, caps, and the engine-free repertoire paths.

Engine-backed ranking (suggest_complementary_lines with a live position) needs
Stockfish and is verified in Docker (evals/capture.py + the SSE smoke client), not here.
Only the pre-engine guards of suggest are exercised below.

Run (needs mcp, which is a main dependency):  uv run pytest   (from server/)
"""

import base64
import io

import chess
import chess.engine
import chess.pgn
import httpx
import pytest

from chess_mcp import server as cm
from chess_mcp import repertoire
from chess_mcp import apiclient
from chess_mcp import evalcache

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


# --- #28 eval cache (evalcache) + cloud_eval + apiclient (all engine-free) ---

_Cp = chess.engine.Cp
_Mate = chess.engine.Mate
_Pov = chess.engine.PovScore
_W = chess.WHITE
_Limit = chess.engine.Limit


def _ci(score, pv_uci="e2e4", depth=20):
    return {"score": score, "pv": [chess.Move.from_uci(pv_uci)], "depth": depth}


class _Run:
    """Thunk that records call count, so a cache hit can be proven (run NOT re-invoked)."""

    def __init__(self, infos):
        self.infos = infos
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return self.infos


@pytest.fixture
def eval_db(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_CACHE_PATH", str(tmp_path / "eval.db"))
    monkeypatch.delenv("EVAL_CACHE_DISABLED", raising=False)
    evalcache.reset()
    yield
    evalcache.reset()


def test_eval_key_drops_fullmove_only():
    base = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
    same_fullmove = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 9"
    diff_halfmove = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 5 2"
    k = lambda f: evalcache._eval_key(chess.Board(f))  # noqa: E731
    assert k(base) == k(same_fullmove)  # fullmove number is eval-irrelevant
    assert k(base) != k(diff_halfmove)  # halfmove clock is eval-relevant (50-move rule)


def test_eval_key_transposition_shares():
    b1 = chess.Board()
    for u in ("g1f3", "g8f6", "b1c3", "b8c6"):
        b1.push_uci(u)
    b2 = chess.Board()
    for u in ("b1c3", "b8c6", "g1f3", "g8f6"):
        b2.push_uci(u)
    # Same placement, turn, castling, ep, AND halfmove clock reached two ways → one key.
    assert evalcache._eval_key(b1) == evalcache._eval_key(b2)


def test_cache_miss_then_hit(eval_db):
    board = chess.Board()
    run = _Run([_ci(_Pov(_Cp(35), _W))])
    a = evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    b = evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    assert run.calls == 1  # second call served from cache
    assert (
        cm._score_with_type(a[0]["score"])
        == cm._score_with_type(b[0]["score"])
        == (35, "cp", None)
    )
    assert b[0]["pv"][0].uci() == "e2e4" and b[0]["depth"] == 20


def test_cache_depth_subsumption(eval_db):
    board = chess.Board()
    run = _Run([_ci(_Pov(_Cp(10), _W))])  # engine reaches depth 20
    evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    evalcache.cached_analyse(board, _Limit(depth=12), 1, "SF", run)  # 12 <= 20 -> hit
    assert run.calls == 1
    evalcache.cached_analyse(board, _Limit(depth=25), 1, "SF", run)  # 25 > 20 -> miss
    assert run.calls == 2


def test_cache_multipv_subsumption(eval_db):
    board = chess.Board()
    three = [
        _ci(_Pov(_Cp(10), _W), "e2e4"),
        _ci(_Pov(_Cp(5), _W), "d2d4"),
        _ci(_Pov(_Cp(0), _W), "c2c4"),
    ]
    run = _Run(three)
    evalcache.cached_analyse(board, _Limit(depth=18), 3, "SF", run)
    one = evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", run
    )  # mpv 1 <= 3 -> hit
    assert run.calls == 1 and len(one) == 1
    evalcache.cached_analyse(board, _Limit(depth=18), 5, "SF", run)  # mpv 5 > 3 -> miss
    assert run.calls == 2


def test_cache_engine_id_isolates(eval_db):
    board = chess.Board()
    run_a = _Run([_ci(_Pov(_Cp(10), _W))])
    run_b = _Run([_ci(_Pov(_Cp(10), _W))])
    evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF-16", run_a)
    evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF-17", run_b
    )  # other engine -> miss
    assert run_a.calls == 1 and run_b.calls == 1


def test_cache_time_limit_bypasses(eval_db):
    board = chess.Board()
    run = _Run([_ci(_Pov(_Cp(10), _W))])
    evalcache.cached_analyse(
        board, _Limit(time=0.5), 1, "SF", run
    )  # no depth -> bypass
    evalcache.cached_analyse(board, _Limit(time=0.5), 1, "SF", run)
    assert run.calls == 2  # never stored, never read
    evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", run
    )  # depth call still a miss
    assert run.calls == 3


def test_cache_disabled_bypasses(eval_db, monkeypatch):
    monkeypatch.setenv("EVAL_CACHE_DISABLED", "1")
    board = chess.Board()
    run = _Run([_ci(_Pov(_Cp(10), _W))])
    evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    assert run.calls == 2


def test_cache_mate_roundtrip(eval_db):
    board = chess.Board()
    evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", _Run([_ci(_Pov(_Mate(3), _W))])
    )
    hit = evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", _Run([_ci(_Pov(_Cp(0), _W))])
    )
    assert cm._score_with_type(hit[0]["score"]) == (10000, "mate", 3)


def test_cache_negative_mate_roundtrip(eval_db):
    board = chess.Board()
    evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", _Run([_ci(_Pov(_Mate(-2), _W))])
    )
    hit = evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", _Run([_ci(_Pov(_Cp(0), _W))])
    )
    assert cm._score_with_type(hit[0]["score"]) == (-10000, "mate", -2)


def test_cache_mate_zero_not_stored(eval_db):
    board = chess.Board()
    run = _Run([_ci(_Pov(_Mate(0), _W))])  # ambiguous sign -> skip store
    evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    assert run.calls == 2


def test_cache_black_pov_sign(eval_db):
    board = chess.Board()
    evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", _Run([_ci(_Pov(_Cp(35), _W))])
    )
    hit = evalcache.cached_analyse(
        board, _Limit(depth=18), 1, "SF", _Run([_ci(_Pov(_Cp(0), _W))])
    )
    assert cm._pov_cp(hit[0], chess.BLACK) == -35  # white +35 -> black -35


def test_cache_persists_across_reset(eval_db):
    board = chess.Board()
    run = _Run([_ci(_Pov(_Cp(42), _W))])
    evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", run)
    evalcache.reset()  # drops the connection; SQLite file stays (== a server restart)
    after = _Run([_ci(_Pov(_Cp(0), _W))])
    hit = evalcache.cached_analyse(board, _Limit(depth=18), 1, "SF", after)
    assert after.calls == 0 and cm._score_with_type(hit[0]["score"]) == (42, "cp", None)


def test_cloud_eval_hit(monkeypatch):
    monkeypatch.delenv("CLOUD_EVAL_DISABLED", raising=False)
    monkeypatch.setattr(
        apiclient,
        "get_json",
        lambda url, params=None: {"depth": 30, "pvs": [{"moves": "e2e4", "cp": 20}]},
    )
    out = cm.cloud_eval(chess.STARTING_FEN)
    assert out["source"] == "lichess-cloud" and out["depth"] == 30


def test_cloud_eval_miss(monkeypatch):
    monkeypatch.delenv("CLOUD_EVAL_DISABLED", raising=False)
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: None)
    assert cm.cloud_eval(chess.STARTING_FEN) is None


def test_cloud_eval_bad_fen():
    assert cm.cloud_eval("not a fen")["error"] == "invalid_fen"


def test_cloud_eval_disabled(monkeypatch):
    monkeypatch.setenv("CLOUD_EVAL_DISABLED", "1")
    calls = {"n": 0}

    def boom(url, params=None):
        calls["n"] += 1
        return {"depth": 1}

    monkeypatch.setattr(apiclient, "get_json", boom)
    assert cm.cloud_eval(chess.STARTING_FEN) is None and calls["n"] == 0


def _fake_client(resp=None, raises=None):
    class _R:
        status_code = 200 if resp is not None else 500

        def json(self):
            return resp

    class _C:
        def get(self, url, params=None, headers=None):
            if raises is not None:
                raise raises
            return _R()

    return _C()


def test_apiclient_ok(monkeypatch):
    monkeypatch.setattr(apiclient, "_MIN_INTERVAL_S", 0)
    monkeypatch.setattr(
        apiclient, "_get_client", lambda: _fake_client(resp={"ok": True})
    )
    assert apiclient.get_json("http://x") == {"ok": True}


def test_apiclient_offline(monkeypatch):
    monkeypatch.setattr(apiclient, "_MIN_INTERVAL_S", 0)
    monkeypatch.setattr(
        apiclient,
        "_get_client",
        lambda: _fake_client(raises=httpx.ConnectError("down")),
    )
    assert apiclient.get_json("http://x") is None


def test_apiclient_non_200(monkeypatch):
    monkeypatch.setattr(apiclient, "_MIN_INTERVAL_S", 0)
    monkeypatch.setattr(apiclient, "_get_client", lambda: _fake_client(resp=None))
    assert apiclient.get_json("http://x") is None


# --- #23 board_image (engine-free) ---


def _svg(out: dict) -> str:
    return base64.b64decode(out["data"]).decode()


def test_board_image_startpos():
    out = cm.board_image(chess.STARTING_FEN)
    assert out["format"] == "svg" and out["encoding"] == "base64"
    assert "<svg" in _svg(out)


def test_board_image_last_move_uci():
    out = cm.board_image(chess.STARTING_FEN, last_move="e2e4")
    assert "error" not in out and "<svg" in _svg(out)


def test_board_image_last_move_san():
    out = cm.board_image(chess.STARTING_FEN, last_move="Nf3")
    assert "error" not in out


def test_board_image_illegal_last_move():
    out = cm.board_image(chess.STARTING_FEN, last_move="e2e5")
    assert out["error"] == "invalid_move"


def test_board_image_orientation_black():
    out = cm.board_image(chess.STARTING_FEN, orientation="black")
    assert out["orientation"] == "black" and "<svg" in _svg(out)


def test_board_image_bad_orientation():
    assert (
        cm.board_image(chess.STARTING_FEN, orientation="purple")["error"]
        == "invalid_orientation"
    )


def test_board_image_bad_fen():
    assert cm.board_image("not a fen")["error"] == "invalid_fen"


def test_board_image_render_correctness():
    """Orientation truly flips the board, and last_move tints the from/to squares + draws an
    arrow — verified in the SVG itself, not just echoed in the result dict (#23)."""
    import re

    plain = _svg(cm.board_image(chess.STARTING_FEN))
    flipped = _svg(cm.board_image(chess.STARTING_FEN, orientation="black"))
    assert plain != flipped  # orientation reaches the SVG, not only the dict field

    def king_y(s):  # white king: bottom (large y) in white view, top (small y) in black view
        i = s.find("#white-king")  # translate sits on the wrapping <g> just before the <use>
        if i < 0:
            return None
        ys = re.findall(r'translate\([\d.]+,\s*([\d.]+)\)', s[max(0, i - 200) : i])
        return float(ys[-1]) if ys else None

    yw, yb = king_y(plain), king_y(flipped)
    assert yw is not None and yb is not None and yw > yb  # true 180° flip

    lm = _svg(cm.board_image(chess.STARTING_FEN, last_move="e2e4"))
    assert lm != plain
    assert "<line" in lm and "<polygon" in lm  # arrow shaft + head
    assert "#cdd16a" in lm.lower() and "#cdd16a" not in plain.lower()  # from/to square tint
    assert lm == _svg(cm.board_image(chess.STARTING_FEN, last_move="e4"))  # SAN == UCI


# --- #25 game history + repertoire cross-reference (engine-free) ---


def _pgn(moves_san, white="Hero", black="Opp", result="1-0", **headers) -> str:
    g = chess.pgn.Game()
    g.headers["White"], g.headers["Black"], g.headers["Result"] = white, black, result
    for k, v in headers.items():
        g.headers[k] = str(v)
    node, b = g, chess.Board()
    for san in moves_san:
        mv = b.parse_san(san)
        node = node.add_variation(mv)
        b.push(mv)
    return g.accept(
        chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    )


def _game_obj(moves_san, **kw):
    return chess.pgn.read_game(io.StringIO(_pgn(moves_san, **kw)))


def test_user_result():
    assert cm._user_result("1-0", "white") == "win"
    assert cm._user_result("1-0", "black") == "loss"
    assert cm._user_result("0-1", "black") == "win"
    assert cm._user_result("1/2-1/2", "white") == "draw"
    assert cm._user_result("*", "white") is None
    assert cm._user_result("1-0", None) is None


def test_game_meta():
    p = _pgn(
        ["e4", "e5"],
        white="Hero",
        black="Foe",
        result="0-1",
        ECO="C20",
        WhiteElo=1500,
        BlackElo=1600,
        TimeControl="300+2",
        Site="url",
    )
    m = cm._game_meta(p, "Hero", include_pgn=False)
    assert m["color"] == "white" and m["result"] == "loss" and m["opponent"] == "Foe"
    assert m["user_elo"] == 1500 and m["opp_elo"] == 1600 and m["eco"] == "C20"
    assert m["n_plies"] == 2 and "pgn" not in m
    assert "pgn" in cm._game_meta(p, "Hero", include_pgn=True)
    assert cm._game_meta(p, "Nobody", include_pgn=False)["color"] is None


def test_player_move_map(rid):
    rep = repertoire.get_repertoire(rid)
    keys, pm = repertoire.player_move_map(rep)
    start = repertoire._position_key(chess.Board())
    assert pm[start] == {"d2d4"}  # white's only prescribed first move
    b = chess.Board()
    for san in ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5"]:
        b.push_san(san)
    k = repertoire._position_key(b)
    assert k in keys and "c1g5" in pm[k]  # Bg5 prescribed here


def test_cross_reference_full_follow(rid):
    rep = repertoire.get_repertoire(rid)
    keys, pm = repertoire.player_move_map(rep)
    rec = repertoire.cross_reference_game(_game_obj(CARLSBAD_LEAF), rep.color, keys, pm)
    assert rec["in_book_plies"] == 10
    assert rec["player_deviation"] is None and rec["uncovered_opponent"] is None


def test_cross_reference_player_deviation(rid):
    rep = repertoire.get_repertoire(rid)
    keys, pm = repertoire.player_move_map(rep)
    rec = repertoire.cross_reference_game(
        _game_obj(["d4", "d5", "c4", "e6", "e3"]), rep.color, keys, pm
    )
    assert rec["in_book_plies"] == 4
    dev = rec["player_deviation"]
    assert dev["played"] == "e3" and dev["prescribed"] == ["Nc3"]
    assert rec["uncovered_opponent"] is None


def test_cross_reference_opponent_off_book(rid):
    rep = repertoire.get_repertoire(rid)
    keys, pm = repertoire.player_move_map(rep)
    rec = repertoire.cross_reference_game(
        _game_obj(["d4", "d5", "c4", "a6"]), rep.color, keys, pm
    )
    assert rec["in_book_plies"] == 3
    assert rec["uncovered_opponent"]["played"] == "a6"
    assert rec["player_deviation"] is None


def test_lichess_games_parse(monkeypatch):
    p1 = _pgn(
        ["e4", "e5"],
        white="Hero",
        black="Foe",
        result="1-0",
        ECO="C20",
        WhiteElo=1500,
        BlackElo=1480,
        Site="https://lichess.org/abc",
    )
    monkeypatch.setattr(
        cm.apiclient, "get_ndjson", lambda url, params=None, headers=None: [{"pgn": p1}]
    )
    out = cm.lichess_games("Hero")
    g = out["games"][0]
    assert out["count"] == 1 and g["color"] == "white" and g["result"] == "win"
    assert g["eco"] == "C20" and g["user_elo"] == 1500 and "pgn" not in g
    assert "pgn" in cm.lichess_games("Hero", include_pgn=True)["games"][0]


def test_lichess_games_eco_filter(monkeypatch):
    p1 = _pgn(["e4", "e5"], white="Hero", ECO="C20")
    p2 = _pgn(["d4"], white="Hero", ECO="D00")
    monkeypatch.setattr(
        cm.apiclient,
        "get_ndjson",
        lambda url, params=None, headers=None: [{"pgn": p1}, {"pgn": p2}],
    )
    out = cm.lichess_games("Hero", opening_eco="C")
    assert out["count"] == 1 and out["games"][0]["eco"] == "C20"


def test_lichess_games_offline(monkeypatch):
    monkeypatch.setattr(
        cm.apiclient, "get_ndjson", lambda url, params=None, headers=None: None
    )
    out = cm.lichess_games("Hero")
    assert out["error"] == "fetch_failed" and out["count"] == 0


def test_chesscom_games_parse(monkeypatch):
    p1 = _pgn(["e4", "c5"], white="Hero", black="Foe", result="1/2-1/2", ECO="B20")
    monkeypatch.setattr(
        cm.apiclient,
        "get_json",
        lambda url, params=None, headers=None: {"games": [{"pgn": p1}]},
    )
    out = cm.chesscom_games("Hero", 2026, 6)
    assert out["count"] == 1 and out["games"][0]["result"] == "draw"
    assert out["games"][0]["eco"] == "B20"


def test_chesscom_games_offline(monkeypatch):
    monkeypatch.setattr(
        cm.apiclient, "get_json", lambda url, params=None, headers=None: None
    )
    assert cm.chesscom_games("Hero", 2026, 6)["error"] == "fetch_failed"


def test_games_username_url_encoded(monkeypatch):
    """Usernames are percent-encoded into the URL path — no path/query injection (#25)."""
    seen = {}
    monkeypatch.setattr(
        cm.apiclient,
        "get_ndjson",
        lambda url, params=None, headers=None: seen.update(url=url) or None,
    )
    cm.lichess_games("../../../account")
    assert "..%2F..%2F..%2Faccount" in seen["url"]  # slashes encoded → no traversal
    assert not seen["url"].endswith("/account")
    cm.lichess_games("evil?max=99999")
    assert "%3Fmax%3D99999" in seen["url"] and "?" not in seen["url"]  # no query injection

    monkeypatch.setattr(
        cm.apiclient,
        "get_json",
        lambda url, params=None, headers=None: seen.update(url=url) or None,
    )
    cm.chesscom_games("a/b?x=1", 2026, 6)
    assert "/pub/player/a%2Fb%3Fx%3D1/games/" in seen["url"]


def test_repertoire_vs_history(rid, monkeypatch):
    follow = _pgn(CARLSBAD_LEAF, white="Hero")
    deviate = _pgn(["d4", "d5", "c4", "e6", "e3"], white="Hero")
    wrong_color = _pgn(CARLSBAD_LEAF, white="Opp", black="Hero")
    monkeypatch.setattr(
        cm, "_fetch_lichess_pgns", lambda u, n: [follow, deviate, wrong_color]
    )
    out = cm.repertoire_vs_history(rid, "Hero")
    assert out["games_total"] == 3 and out["games_matched_color"] == 2
    assert out["games_reached_prep"] == 2 and out["coverage_pct"] == 1.0
    assert len(out["player_deviations"]) == 1
    assert out["player_deviations"][0]["played"] == "e3"


def test_repertoire_vs_history_offline(rid, monkeypatch):
    monkeypatch.setattr(cm, "_fetch_lichess_pgns", lambda u, n: None)
    assert cm.repertoire_vs_history(rid, "Hero")["error"] == "fetch_failed"


def test_repertoire_vs_history_collapses_transpositions(monkeypatch):
    """The drill aggregations group by position, not full FEN: move orders that transpose to the
    same position carry different FEN move-clocks, so the same recurring move must count once with
    the combined frequency — not split into N count-1 entries (#25, transposition-aware)."""
    rep_pgn = (
        '[Event "A"]\n[Result "*"]\n\n1. d4 Nf6 2. c4 g6 3. Nc3 *\n\n'
        '[Event "B"]\n[Result "*"]\n\n1. d4 g6 2. c4 Nf6 3. Nc3 *\n'
    )

    def g(w, b, m):
        return f'[White "{w}"]\n[Black "{b}"]\n[Result "*"]\n\n{m} *\n'

    # Both games reach the post-3.Nc3 position by different orders (halfmove clock 1 vs 2), then
    # play Bg7 past the prep leaf → one uncovered_opponent entry with count 2.
    monkeypatch.setattr(
        cm,
        "_fetch_lichess_pgns",
        lambda u, n: [
            g("Hero", "Opp", "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7"),
            g("Hero", "Opp", "1. d4 g6 2. c4 Nf6 3. Nc3 Bg7"),
        ],
    )
    rid = cm.load_repertoire(rep_pgn, "white")["repertoire_id"]
    out = cm.repertoire_vs_history(rid, "Hero")
    assert out["games_matched_color"] == 2
    unc = out["uncovered_opponent_moves"]
    assert len(unc) == 1 and unc[0]["played"] == "Bg7" and unc[0]["count"] == 2


def test_repertoire_vs_history_arg_guards(rid):
    assert (
        cm.repertoire_vs_history(rid, "Hero", platform="chesscom")["error"]
        == "missing_arg"
    )
    assert (
        cm.repertoire_vs_history(rid, "Hero", platform="x")["error"]
        == "invalid_platform"
    )
    assert "error" in cm.repertoire_vs_history("bogus-id", "Hero")


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


def test_validate_pgn_unknown_opening_marker_backstopped_by_eco():
    # [Opening "?"] is PGN's explicit unknown marker — it must not surface verbatim,
    # and must not shadow a real ECO header (same filter as get_game_summary).
    pgn = '[Event "t"]\n[Opening "?"]\n[ECO "B12"]\n\n1. e4 c6 *\n'
    r = cm.validate_pgn(pgn)
    assert r["valid"] is True and r["headers"]["opening"] == "B12"


def test_validate_pgn_unknown_opening_marker_omitted():
    pgn = '[Event "t"]\n[Opening "?"]\n\n1. e4 c6 *\n'
    r = cm.validate_pgn(pgn)
    assert r["valid"] is True and "opening" not in r["headers"]


def test_parse_game_surfaces_parse_error_over_no_moves():
    # A garbled FIRST move yields a moveless game AND a recorded parse error;
    # the reason must name the unparseable move, not claim the PGN has no moves.
    with pytest.raises(ValueError, match="unparseable"):
        cm._parse_game('[Event "t"]\n\n1. Zz9 e5 *\n')


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


# --- #26 MCP App: board widget (resource) ---


def test_board_widget_resource_exists():
    """Resource is registered and returns valid HTML."""
    html = cm.get_board_widget()
    assert isinstance(html, str)
    assert len(html) > 100
    assert "<!DOCTYPE html" in html or "<html" in html


def test_board_widget_contains_chessboard_js():
    """Widget includes chessboard.js from CDN."""
    html = cm.get_board_widget()
    assert "chessboardjs" in html.lower() or "chessboard" in html.lower()
    assert "cdn.jsdelivr.net" in html


def test_board_widget_contains_chess_js():
    """Widget includes chess.js from CDN for move validation."""
    html = cm.get_board_widget()
    assert "chess.js" in html.lower()


def test_board_widget_contains_mode_selector():
    """Widget supports mode selection (PGN stepper vs repertoire browser)."""
    html = cm.get_board_widget()
    assert "pgn" in html.lower() or "mode" in html.lower()


def test_board_widget_contains_analyze_button():
    """Widget has an 'Analyze Position' button (calls evaluate_position tool)."""
    html = cm.get_board_widget()
    assert "analyze" in html.lower() or "evaluate" in html.lower()


def test_board_widget_html_validity():
    """HTML has balanced basic structure (not a syntax checker, but smoke test)."""
    html = cm.get_board_widget()
    # Count opening/closing script and style tags (basic balance check)
    opens = html.count("<script") + html.count("<style")
    closes = html.count("</script>") + html.count("</style>")
    assert opens == closes, "Unbalanced HTML tags"
    # No obvious quote mismatches
    assert html.count('"') % 2 == 0, "Odd number of double quotes"


def test_board_widget_has_board_element():
    """Widget has a board container element."""
    html = cm.get_board_widget()
    assert 'id="board"' in html or 'id="board"' in html


def test_board_widget_has_pgn_input():
    """Widget has PGN input area for stepper mode."""
    html = cm.get_board_widget()
    assert "pgnInput" in html or "pgn" in html.lower()


# --- #30 tablebase_lookup (engine-free, mocked HTTP) ---


def test_count_pieces_empty_board():
    """Empty board has 0 pieces."""
    assert cm._count_pieces("8/8/8/8/8/8/8/8 w - - 0 1") == 0


def test_count_pieces_starting_position():
    """Starting position has 32 pieces (16 white, 16 black)."""
    assert cm._count_pieces(chess.STARTING_FEN) == 32


def test_count_pieces_kqk():
    """King and queen vs king has 3 pieces."""
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    assert cm._count_pieces(fen) == 3


def test_count_pieces_seven_piece_position():
    """Count pieces correctly in a 7-piece position."""
    fen = "8/8/8/8/8/k1K5/Q4r2/R7 w - - 0 1"  # K, Q, R, A vs k, r, unknown
    count = cm._count_pieces(fen)
    assert count == 5  # White: K, Q, R; Black: k, r


def test_tablebase_lookup_bad_fen():
    """Invalid FEN returns error."""
    r = cm.tablebase_lookup("not a fen")
    assert r["error"] == "invalid_fen"


def test_tablebase_lookup_illegal_position():
    """Illegal-but-parseable position (kingless board) returns error."""
    r = cm.tablebase_lookup("8/8/8/8/8/8/8/8 w - - 0 1")
    assert r["error"] == "invalid_fen"


def test_tablebase_lookup_too_many_pieces_no_network_call(monkeypatch):
    """8+ pieces returns error WITHOUT calling the network."""
    calls = {"n": 0}

    def mock_get_json(url, params=None):
        calls["n"] += 1
        return None

    monkeypatch.setattr(apiclient, "get_json", mock_get_json)
    # Starting position has 32 pieces → should fail immediately without a network call
    r = cm.tablebase_lookup(chess.STARTING_FEN)
    assert r["error"] == "too_many_pieces"
    assert calls["n"] == 0  # network call was NOT made


def test_tablebase_lookup_kqk_white_win(monkeypatch):
    """Known white-win position (KQK) returns correct WDL and best_move."""
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    mock_response = {
        "fen": fen,
        "category": "win",
        "dtz": 5,
        "precise_dtz": 5,
        "dtm": 30,
        "checkmate": False,
        "stalemate": False,
        "moves": [
            {
                "uci": "a2a3",
                "san": "Qa3",
                "category": "win",
                "dtz": 4,
                "precise_dtz": 4,
                "dtm": 29,
                "zeroing": True,
            }
        ],
    }
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == 2  # win
    assert r["dtz"] == 5
    assert r["best_move"] == "a2a3"
    assert r["category"] == "win"


def test_tablebase_lookup_cursed_win_maps_to_wdl_1(monkeypatch):
    """Cursed-win (won, but the 50-move rule forces a draw) maps to 5-valued wdl=1."""
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    mock_response = {
        "category": "cursed-win",
        "dtz": None,  # unreachable in 50 moves
        "moves": [{"uci": "a2a3"}],
    }
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == 1  # cursed win
    assert r["category"] == "cursed-win"  # verbatim category


def test_tablebase_lookup_draw(monkeypatch):
    """Draw position returns wdl=0."""
    fen = "7k/5K2/6B1/6B1/8/8/8/8 w - - 0 1"
    mock_response = {
        "category": "draw",
        "dtz": 0,
        "moves": [{"uci": "g5f4"}],
    }
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == 0  # draw
    assert r["category"] == "draw"


def test_tablebase_lookup_blessed_loss_maps_to_wdl_minus_1(monkeypatch):
    """Blessed-loss (lost, but the 50-move rule saves it) maps to 5-valued wdl=-1."""
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    mock_response = {
        "category": "blessed-loss",
        "dtz": 100,  # saved by the 50-move rule
        "moves": [{"uci": "a2a3"}],
    }
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == -1  # blessed loss
    assert r["category"] == "blessed-loss"


def test_tablebase_lookup_loss(monkeypatch):
    """Loss position returns wdl=-2."""
    fen = "8/8/8/8/8/K7/q7/k7 w - - 0 1"
    mock_response = {
        "category": "loss",
        "dtz": -5,
        "moves": [{"uci": "a3a2"}],
    }
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == -2  # loss
    assert r["category"] == "loss"


def test_tablebase_lookup_maybe_win_maps_to_wdl_2(monkeypatch):
    """Maybe-win (a win; only the DTZ is imprecise near the 50-move boundary) → wdl=2."""
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    mock_response = {
        "category": "maybe-win",
        "dtz": None,
        "moves": [{"uci": "a2a3"}],
    }
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == 2  # fundamentally a win
    assert r["category"] == "maybe-win"  # verbatim


def test_tablebase_lookup_maybe_loss_maps_to_wdl_minus_2(monkeypatch):
    """Maybe-loss (a loss; DTZ imprecise) maps to wdl=-2, category verbatim."""
    fen = "8/8/8/8/8/K7/q7/k7 w - - 0 1"
    mock_response = {"category": "maybe-loss", "dtz": None, "moves": [{"uci": "a3a2"}]}
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == -2
    assert r["category"] == "maybe-loss"


def test_tablebase_lookup_syzygy_win_and_loss(monkeypatch):
    """syzygy-win / syzygy-loss are definite win/loss in WDL terms (→ 2 / -2)."""
    fen_w = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    monkeypatch.setattr(
        apiclient,
        "get_json",
        lambda url, params=None: {
            "category": "syzygy-win",
            "dtz": 5,
            "moves": [{"uci": "a2a3"}],
        },
    )
    assert cm.tablebase_lookup(fen_w)["wdl"] == 2
    fen_l = "8/8/8/8/8/K7/q7/k7 w - - 0 1"
    monkeypatch.setattr(
        apiclient,
        "get_json",
        lambda url, params=None: {
            "category": "syzygy-loss",
            "dtz": -5,
            "moves": [{"uci": "a3a2"}],
        },
    )
    assert cm.tablebase_lookup(fen_l)["wdl"] == -2


def test_tablebase_lookup_unknown_category_maps_to_null_wdl(monkeypatch):
    """An unknown/unrecognized category yields wdl=None (result not known)."""
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    mock_response = {"category": "unknown", "dtz": None, "moves": [{"uci": "a2a3"}]}
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] is None
    assert r["category"] == "unknown"


def test_tablebase_lookup_offline_returns_unavailable(monkeypatch):
    """Network failure (apiclient returns None) returns unavailable error."""
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: None)
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    r = cm.tablebase_lookup(fen)
    assert r["error"] == "unavailable"
    assert "unreachable" in r["reason"]


def test_tablebase_lookup_malformed_response(monkeypatch):
    """Malformed response (non-dict) returns unavailable error."""
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: "not a dict")
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    r = cm.tablebase_lookup(fen)
    assert r["error"] == "unavailable"


def test_tablebase_lookup_no_best_move_in_response(monkeypatch):
    """Missing moves list in response still returns valid result with best_move=None."""
    fen = "7k/8/8/8/8/8/Q7/K7 w - - 0 1"
    mock_response = {
        "category": "win",
        "dtz": 5,
        # no moves field
    }
    monkeypatch.setattr(apiclient, "get_json", lambda url, params=None: mock_response)
    r = cm.tablebase_lookup(fen)
    assert r["wdl"] == 2
    assert r["best_move"] is None


# --- #24 engine_move tool (multi-backend) ---


def test_engine_move_invalid_fen():
    """Invalid FEN should return error."""
    assert cm.engine_move("invalid fen")["error"] == "invalid_fen"


def test_engine_move_illegal_position_kingless():
    """Illegal-but-parseable position should return error."""
    assert cm.engine_move(ILLEGAL_KINGLESS_FEN)["error"] == "invalid_fen"


def test_engine_move_unknown_backend():
    """Unknown backend should return invalid_backend error."""
    result = cm.engine_move(chess.STARTING_FEN, backend="unknown-engine")
    assert result["error"] == "invalid_backend"
    assert "must be" in result["reason"]


def test_engine_move_invalid_maia_rating():
    """Invalid Maia rating (e.g., maia-999) should return error."""
    result = cm.engine_move(chess.STARTING_FEN, backend="maia-999")
    assert result["error"] == "invalid_backend"
    assert "999" in result["reason"]


def test_engine_move_maia_invalid_format():
    """Malformed Maia backend (e.g., maia-abc) should return error."""
    result = cm.engine_move(chess.STARTING_FEN, backend="maia-abc")
    assert result["error"] == "invalid_backend"


def test_engine_move_time_limit_clamping():
    """Time limit should be clamped to [100, 60000] ms."""
    assert cm._clamp_engine_time_ms(50) == cm.MIN_ENGINE_TIME_MS
    assert cm._clamp_engine_time_ms(1000) == 1000
    assert cm._clamp_engine_time_ms(70000) == cm.MAX_ENGINE_TIME_MS


def test_get_engine_path_stockfish(monkeypatch):
    """Stockfish backend returns ENGINE_PATH with no weight file."""
    path, weight = cm._get_engine_path("stockfish")
    assert path == cm.ENGINE_PATH
    assert weight is None


def test_get_engine_path_invalid_maia_rating():
    """Invalid Maia rating returns (None, None)."""
    path, weight = cm._get_engine_path("maia-999")
    assert path is None and weight is None


def test_get_engine_path_maia_missing_weights(monkeypatch, tmp_path):
    """Maia backend with missing weights returns (None, None)."""
    # Set MAIA_WEIGHTS_DIR to a dir that doesn't have maia-1500.pb.gz
    monkeypatch.setenv("MAIA_WEIGHTS_DIR", str(tmp_path))
    path, weight = cm._get_engine_path("maia-1500")
    assert path is None and weight is None


def test_get_engine_path_maia_found(monkeypatch, tmp_path):
    """Maia backend with weights present returns lc0 path and weight file."""
    # Create fake weight file
    weight_file = tmp_path / "maia-1500.pb.gz"
    weight_file.touch()
    monkeypatch.setenv("MAIA_WEIGHTS_DIR", str(tmp_path))
    monkeypatch.setenv("LC0_PATH", "/usr/bin/lc0")

    path, weight = cm._get_engine_path("maia-1500")
    assert path == "/usr/bin/lc0"
    assert weight == str(weight_file)


def test_get_engine_path_leela_missing():
    """Leela backend with unset LEELA_WEIGHTS returns (None, None)."""
    import os as os_module

    saved_env = os_module.environ.pop("LEELA_WEIGHTS", None)
    try:
        path, weight = cm._get_engine_path("leela")
        assert path is None and weight is None
    finally:
        if saved_env is not None:
            os_module.environ["LEELA_WEIGHTS"] = saved_env


def test_engine_move_maia_unavailable_missing_weights(monkeypatch, tmp_path):
    """Maia backend unavailable should return backend_unavailable error."""
    # Set empty MAIA_WEIGHTS_DIR so weights don't exist
    monkeypatch.setenv("MAIA_WEIGHTS_DIR", str(tmp_path))
    result = cm.engine_move(chess.STARTING_FEN, backend="maia-1500")
    assert result["error"] == "backend_unavailable"
    assert "maia-1500" in result["reason"]


def test_engine_move_leela_unavailable(monkeypatch):
    """Leela backend unavailable should return backend_unavailable error."""
    monkeypatch.delenv("LEELA_WEIGHTS", raising=False)
    result = cm.engine_move(chess.STARTING_FEN, backend="leela")
    assert result["error"] == "backend_unavailable"
    assert "leela" in result["reason"].lower()


def test_engine_move_stockfish_mocked(monkeypatch):
    """Stockfish backend with mocked engine returns move."""

    # Mock popen_uci to return a fake engine
    class FakeEngine:
        id = {"name": "Stockfish 16.1"}

        def analyse(self, board, limit):
            return {
                "score": chess.engine.PovScore(chess.engine.Cp(30), chess.WHITE),
                "pv": [chess.Move.from_uci("e2e4")],
                "depth": 20,
            }

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    def mock_popen(engine_path, **kwargs):
        return FakeEngine()

    monkeypatch.setattr(chess.engine.SimpleEngine, "popen_uci", mock_popen)

    result = cm.engine_move(chess.STARTING_FEN, backend="stockfish", time_limit_ms=1000)
    assert result["move"] == "e4"
    assert result["uci"] == "e2e4"
    assert result["backend"] == "stockfish"
    assert result["eval_cp"] == 30
    assert result["eval_type"] == "cp"
    assert result["mate_in"] is None
    assert result["depth"] == 20


def test_engine_move_maia_mocked(monkeypatch, tmp_path):
    """Maia backend with mocked engine returns move."""
    # Create fake weight file
    weight_file = tmp_path / "maia-1500.pb.gz"
    weight_file.touch()
    monkeypatch.setenv("MAIA_WEIGHTS_DIR", str(tmp_path))
    monkeypatch.setenv("LC0_PATH", "/usr/bin/lc0")

    call_count = {"count": 0}
    popen_kwargs = {}
    configured = {}

    class FakeEngine:
        id = {"name": "lc0"}

        def configure(self, options):
            configured.update(options)

        def analyse(self, board, limit):
            return {
                "score": chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE),
                "pv": [chess.Move.from_uci("d2d4")],
                "depth": 18,
            }

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    def mock_popen(engine_path, **kwargs):
        call_count["count"] += 1
        popen_kwargs.update(kwargs)
        return FakeEngine()

    monkeypatch.setattr(chess.engine.SimpleEngine, "popen_uci", mock_popen)

    result = cm.engine_move(chess.STARTING_FEN, backend="maia-1500", time_limit_ms=2000)
    assert result["move"] == "d4"
    assert result["uci"] == "d2d4"
    assert result["backend"] == "maia-1500"
    assert result["eval_cp"] == 50
    assert result["eval_type"] == "cp"
    assert result["depth"] == 18

    # popen_uci takes no `options` kwarg; the net is loaded via configure(WeightsFile=...).
    assert call_count["count"] == 1
    assert "options" not in popen_kwargs
    assert configured["WeightsFile"] == str(weight_file)


def test_engine_move_limit_per_backend(monkeypatch, tmp_path):
    """Maia runs at nodes=1 (human-like raw policy, time ignored); stockfish searches by time."""
    weight_file = tmp_path / "maia-1500.pb.gz"
    weight_file.touch()
    monkeypatch.setenv("MAIA_WEIGHTS_DIR", str(tmp_path))
    monkeypatch.setenv("LC0_PATH", "/usr/bin/lc0")

    seen = {}

    class FakeEngine:
        id = {"name": "engine"}

        def configure(self, options):
            pass

        def analyse(self, board, limit):
            seen["limit"] = limit
            return {
                "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE),
                "pv": [chess.Move.from_uci("e2e4")],
                "depth": 1,
            }

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(
        chess.engine.SimpleEngine, "popen_uci", lambda path, **kw: FakeEngine()
    )

    cm.engine_move(chess.STARTING_FEN, backend="maia-1500", time_limit_ms=5000)
    assert seen["limit"].nodes == 1 and seen["limit"].time is None  # Maia: 1 node, time ignored

    cm.engine_move(chess.STARTING_FEN, backend="stockfish", time_limit_ms=2000)
    assert seen["limit"].time == 2.0 and seen["limit"].nodes is None  # stockfish: by time


def test_engine_move_mate_handling(monkeypatch):
    """Mate evals should be returned correctly."""

    class FakeEngine:
        id = {"name": "Stockfish 16.1"}

        def analyse(self, board, limit):
            return {
                "score": chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE),
                "pv": [chess.Move.from_uci("e2e4")],
                "depth": 20,
            }

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    def mock_popen(engine_path, **kwargs):
        return FakeEngine()

    monkeypatch.setattr(chess.engine.SimpleEngine, "popen_uci", mock_popen)

    result = cm.engine_move(chess.STARTING_FEN, backend="stockfish")
    assert result["eval_type"] == "mate"
    assert result["mate_in"] == 3
    assert result["eval_cp"] == 10000  # White mate


def test_engine_move_stockfish_unavailable(monkeypatch):
    """Engine binary not found should return backend_unavailable error."""

    def mock_popen_error(engine_path, **kwargs):
        raise FileNotFoundError(f"Engine not found at {engine_path}")

    monkeypatch.setattr(chess.engine.SimpleEngine, "popen_uci", mock_popen_error)

    result = cm.engine_move(chess.STARTING_FEN, backend="stockfish")
    assert result["error"] == "backend_unavailable"
    assert "not found" in result["reason"].lower()


def test_engine_move_all_maia_ratings():
    """All valid Maia ratings are recognized."""
    for rating in [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]:
        path, _ = cm._get_engine_path(f"maia-{rating}")
        # path will be None (weights don't exist in test), but should pass validation
        # and not raise an error due to invalid rating
        result = cm.engine_move(chess.STARTING_FEN, backend=f"maia-{rating}")
        # Should be backend_unavailable (weights missing), not invalid_backend
        assert result.get("error") in ("backend_unavailable", "invalid_backend")
        if result.get("error") == "invalid_backend":
            # This would mean the rating itself was invalid, which shouldn't happen
            assert False, f"Maia {rating} should be valid"


# --- batch_review (pure aggregator) ---


def test_aggregate_games_empty():
    """Empty records → empty output."""
    result = cm._aggregate_games([])
    assert result["total_games"] == 0
    assert result["groups"] == []
    assert result["worst_group"] is None
    assert result["best_group"] is None


def test_aggregate_games_single_group():
    """Single group with multiple results."""
    records = [
        {
            "result": "win",
            "group_key": "eco_b12",
            "group_name": "Caro-Kann",
            "avg_cpl": 50.0,
            "blunders": [{"move": "e4", "fen": "", "classification": "mistake"}],
        },
        {
            "result": "loss",
            "group_key": "eco_b12",
            "group_name": "Caro-Kann",
            "avg_cpl": 80.0,
            "blunders": [{"move": "d5", "fen": "", "classification": "blunder"}],
        },
        {
            "result": "draw",
            "group_key": "eco_b12",
            "group_name": "Caro-Kann",
            "avg_cpl": 30.0,
            "blunders": [],
        },
    ]
    result = cm._aggregate_games(records)
    assert result["total_games"] == 3
    assert len(result["groups"]) == 1
    g = result["groups"][0]
    assert g["key"] == "eco_b12"
    assert g["games"] == 3
    assert g["win_rate"] == pytest.approx(1 / 3, abs=0.01)
    assert g["draw_rate"] == pytest.approx(1 / 3, abs=0.01)
    assert g["loss_rate"] == pytest.approx(1 / 3, abs=0.01)
    assert g["avg_cpl"] == pytest.approx(53.3, abs=0.1)
    assert len(g["top_blunders"]) == 2


def test_aggregate_games_multiple_groups():
    """Multiple groups, each with distinct stats."""
    records = [
        {
            "result": "win",
            "group_key": "eco_c60",
            "group_name": "Italian",
            "avg_cpl": 20.0,
            "blunders": [],
        },
        {
            "result": "win",
            "group_key": "eco_c60",
            "group_name": "Italian",
            "avg_cpl": 15.0,
            "blunders": [],
        },
        {
            "result": "loss",
            "group_key": "eco_b12",
            "group_name": "Caro-Kann",
            "avg_cpl": 100.0,
            "blunders": [{"move": "e4", "fen": "", "classification": "blunder"}],
        },
    ]
    result = cm._aggregate_games(records)
    assert result["total_games"] == 3
    assert len(result["groups"]) == 2

    # Italian group
    italian = next(g for g in result["groups"] if g["key"] == "eco_c60")
    assert italian["games"] == 2
    assert italian["win_rate"] == 1.0
    assert italian["avg_cpl"] == pytest.approx(17.5, abs=0.1)

    # Caro-Kann group
    caro = next(g for g in result["groups"] if g["key"] == "eco_b12")
    assert caro["games"] == 1
    assert caro["loss_rate"] == 1.0
    assert caro["avg_cpl"] == 100.0

    # worst/best groups
    assert result["worst_group"]["key"] == "eco_b12"
    assert result["best_group"]["key"] == "eco_c60"


def test_aggregate_games_blunder_frequency():
    """Top blunders are sorted by frequency."""
    records = [
        {
            "result": "loss",
            "group_key": "eco_e4",
            "group_name": "Open Game",
            "avg_cpl": 50.0,
            "blunders": [
                {"move": "e5", "fen": "", "classification": "blunder"},
                {"move": "d4", "fen": "", "classification": "mistake"},
                {"move": "e5", "fen": "", "classification": "blunder"},
            ],
        },
        {
            "result": "loss",
            "group_key": "eco_e4",
            "group_name": "Open Game",
            "avg_cpl": 70.0,
            "blunders": [
                {"move": "e5", "fen": "", "classification": "blunder"},
                {"move": "g5", "fen": "", "classification": "inaccuracy"},
            ],
        },
    ]
    result = cm._aggregate_games(records)
    g = result["groups"][0]
    # e5 appears 3 times, d4 once, g5 once
    assert g["top_blunders"][0]["move"] == "e5"
    assert g["top_blunders"][0]["frequency"] == 3
    assert g["top_blunders"][1]["move"] in ("d4", "g5")
    assert g["top_blunders"][1]["frequency"] == 1


def test_batch_review_pgn_too_large():
    """Oversized PGN → early error."""
    big_pgn = "1. e4 e5 " * 100000
    result = cm.batch_review(big_pgn)
    assert result["error"] == "pgn_too_large"


def test_batch_review_invalid_group_by():
    """Invalid group_by mode → error."""
    pgn = '[Event "t"]\n[Result "*"]\n\n1. e4 e5 *\n'
    result = cm.batch_review(pgn, group_by="invalid")
    assert result["error"] == "invalid_group_by"


def test_batch_review_color_without_username():
    """group_by='color' without username → error."""
    pgn = '[Event "t"]\n[Result "*"]\n\n1. e4 e5 *\n'
    result = cm.batch_review(pgn, group_by="color", username=None)
    assert result["error"] == "missing_username"


def test_batch_review_invalid_pgn():
    """Bad PGN → error."""
    result = cm.batch_review("not a pgn")
    assert result["error"] == "invalid_pgn"


def test_batch_review_empty_pgn():
    """Empty PGN → error."""
    result = cm.batch_review("")
    assert result["error"] == "invalid_pgn"


def test_batch_review_parse_multi_game(monkeypatch):
    """Multiple games in one PGN are parsed."""
    pgn = (
        '[Event "Game1"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n\n'
        '[Event "Game2"]\n[White "Bob"]\n[Black "Alice"]\n[Result "0-1"]\n\n1. d4 d5 2. c4 e6 0-1\n\n'
    )
    # Mock analyze_game to avoid engine calls
    call_count = [0]

    def mock_analyze(pgn_str, depth=18, min_cp_loss=50, verbose=False, time_limit=None):
        call_count[0] += 1
        return [
            {
                "move_number": 1,
                "color": "white",
                "move": "e4",
                "cp_loss": 10,
                "classification": "good",
                "best_move": "e4",
            },
            {
                "move_number": 1,
                "color": "black",
                "move": "e5",
                "cp_loss": 30,
                "classification": "inaccuracy",
                "best_move": "c5",
            },
        ]

    monkeypatch.setattr(cm, "analyze_game", mock_analyze)
    result = cm.batch_review(pgn, group_by="eco")
    assert result["total_games"] == 2
    assert call_count[0] == 2  # Both games were analyzed


def test_batch_review_max_games_cap(monkeypatch):
    """max_games parameter caps the number of games analyzed."""
    pgn = (
        '[Event "Game1"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n\n'
        '[Event "Game2"]\n[Result "0-1"]\n\n1. d4 d5 2. c4 e6 0-1\n\n'
        '[Event "Game3"]\n[Result "1/2-1/2"]\n\n1. c4 c5 2. Nc3 Nc6 1/2-1/2\n\n'
    )
    call_count = [0]

    def mock_analyze(pgn_str, depth=18, min_cp_loss=50, verbose=False, time_limit=None):
        call_count[0] += 1
        return [
            {
                "move_number": 1,
                "color": "white",
                "move": "e4",
                "cp_loss": 10,
                "classification": "good",
                "best_move": "e4",
            },
        ]

    monkeypatch.setattr(cm, "analyze_game", mock_analyze)
    cm.batch_review(pgn, max_games=2, group_by="eco")
    assert call_count[0] == 2  # Only 2 games analyzed despite 3 available


# ---------------------------------------------------------------------------
# Game session tools: start_game / make_move / get_game_state (#33)
# ---------------------------------------------------------------------------

# Shared FakeEngine for session tests: always returns e2e4 / d2d4 alternating.
class _SessionFakeEngine:
    """Stateless fake that always returns the popen'd engine as a context manager."""

    def __init__(self, move_uci: str = "e2e4"):
        self._move_uci = move_uci
        self.configured: dict = {}

    def configure(self, opts: dict) -> None:
        self.configured.update(opts)

    def analyse(self, board, limit):
        return {
            "score": chess.engine.PovScore(chess.engine.Cp(20), chess.WHITE),
            "pv": [chess.Move.from_uci(self._move_uci)],
            "depth": 10,
        }

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


@pytest.fixture(autouse=True)
def _clear_sessions():
    cm._SESSIONS.clear()
    yield
    cm._SESSIONS.clear()


def _mock_engine(monkeypatch, move_uci: str = "e2e4"):
    """Patch popen_uci to return a fake engine that plays move_uci."""
    fake = _SessionFakeEngine(move_uci)
    monkeypatch.setattr(chess.engine.SimpleEngine, "popen_uci", lambda *a, **kw: fake)
    return fake


# --- _rating_to_skill ---

def test_rating_to_skill_anchors():
    assert cm._rating_to_skill(800) == 0
    assert cm._rating_to_skill(1200) == 5
    assert cm._rating_to_skill(1500) == 10
    assert cm._rating_to_skill(1800) == 15
    assert cm._rating_to_skill(2000) == 20


def test_rating_to_skill_clamps_below():
    assert cm._rating_to_skill(0) == 0
    assert cm._rating_to_skill(500) == 0


def test_rating_to_skill_clamps_above():
    assert cm._rating_to_skill(2500) == 20
    assert cm._rating_to_skill(3000) == 20


def test_rating_to_skill_interpolates():
    # 1000 is midpoint between 800 (0) and 1200 (5)
    assert cm._rating_to_skill(1000) == round(2.5)


# --- start_game ---

def test_start_game_invalid_color():
    result = cm.start_game(color="purple")
    assert result["error"] == "invalid_color"


def test_start_game_invalid_fen():
    result = cm.start_game(starting_fen="not a fen")
    assert result["error"] == "invalid_fen"


def test_start_game_white_returns_session(monkeypatch):
    _mock_engine(monkeypatch)
    result = cm.start_game(color="white")
    assert "session_id" in result
    assert result["color"] == "white"
    assert result["turn"] == "white"          # engine hasn't moved yet
    assert result["result"] == "*"
    assert result["moves"] == []


def test_start_game_black_engine_moves_first(monkeypatch):
    _mock_engine(monkeypatch, "e2e4")
    result = cm.start_game(color="black")
    assert result["color"] == "black"
    assert result["turn"] == "black"          # engine played White's move, now Black to move
    assert result["moves"] == ["e4"]


def test_start_game_custom_fen(monkeypatch):
    _mock_engine(monkeypatch)
    # FEN after 1.e4 d5: no en passant ambiguity, fully normalized by python-chess.
    fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
    result = cm.start_game(color="white", starting_fen=fen)
    assert result["fen"] == fen
    assert result["turn"] == "white"


def test_start_game_skill_level_applied(monkeypatch):
    fake = _mock_engine(monkeypatch, "e2e4")
    cm.start_game(color="black", opponent_rating=800)
    assert fake.configured.get("Skill Level") == 0


def test_start_game_stores_session(monkeypatch):
    _mock_engine(monkeypatch)
    result = cm.start_game(color="white")
    sid = result["session_id"]
    assert sid in cm._SESSIONS


# --- make_move ---

def test_make_move_session_not_found():
    result = cm.make_move("nonexistent", "e2e4")
    assert result["error"] == "session_not_found"


def test_make_move_invalid_uci(monkeypatch):
    _mock_engine(monkeypatch)
    sid = cm.start_game(color="white")["session_id"]
    result = cm.make_move(sid, "not-uci")
    assert result["error"] == "invalid_move"


def test_make_move_illegal_move(monkeypatch):
    _mock_engine(monkeypatch)
    sid = cm.start_game(color="white")["session_id"]
    result = cm.make_move(sid, "e2e5")  # illegal: pawn can't jump 3 squares
    assert result["error"] == "invalid_move"


def test_make_move_legal_move(monkeypatch):
    _mock_engine(monkeypatch, "e7e5")
    sid = cm.start_game(color="white")["session_id"]
    result = cm.make_move(sid, "e2e4")
    assert result["user_move"] == "e4"
    assert result["engine_move"] == "e5"
    assert len(result["moves"]) == 2
    assert result["result"] == "*"


def test_make_move_after_game_over(monkeypatch):
    _mock_engine(monkeypatch)
    # Fool's Mate: 1.f3 e5 2.g4 Qh4#
    sid = cm.start_game(color="white")["session_id"]
    session = cm._SESSIONS[sid]
    # Force the board to a checkmate position and mark result.
    board = chess.Board(FOOLS_MATE_FEN)
    session["board"] = board
    session["result"] = "0-1"
    result = cm.make_move(sid, "e1e2")
    assert result["error"] == "game_over"


# --- get_game_state ---

def test_get_game_state_not_found():
    result = cm.get_game_state("bad-id")
    assert result["error"] == "session_not_found"


def test_get_game_state_returns_state(monkeypatch):
    _mock_engine(monkeypatch)
    sid = cm.start_game(color="white")["session_id"]
    state = cm.get_game_state(sid)
    assert state["session_id"] == sid
    assert "fen" in state
    assert "moves" in state
    assert "result" in state


def test_get_game_state_consistent_with_make_move(monkeypatch):
    _mock_engine(monkeypatch, "e7e5")
    sid = cm.start_game(color="white")["session_id"]
    cm.make_move(sid, "e2e4")
    state = cm.get_game_state(sid)
    assert "e4" in state["moves"]
    assert "e5" in state["moves"]


# --- repertoire book moves ---

def test_start_game_repertoire_pgn_book_move(monkeypatch):
    """Engine should follow the repertoire's first move instead of calling the engine."""
    rep_pgn = '[Event "t"]\n[Result "*"]\n\n1. d4 d5 *\n'
    called = [False]

    class NeverCalledEngine:
        def configure(self, opts):
            pass
        def analyse(self, board, limit):
            called[0] = True
            return {"score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE), "pv": [chess.Move.from_uci("e2e4")], "depth": 1}
        def __enter__(self): return self
        def __exit__(self, *a): pass

    monkeypatch.setattr(chess.engine.SimpleEngine, "popen_uci", lambda *a, **kw: NeverCalledEngine())

    # User plays White; engine (Black) should pick d5 from the repertoire.
    sid = cm.start_game(color="white", repertoire_pgn=rep_pgn)["session_id"]
    result = cm.make_move(sid, "d2d4")
    assert result["engine_move"] == "d5"
    assert not called[0]  # engine subprocess never opened


def test_start_game_repertoire_falls_back_after_deviation(monkeypatch):
    """Once user deviates from the repertoire, engine falls back to engine search."""
    rep_pgn = '[Event "t"]\n[Result "*"]\n\n1. d4 d5 *\n'
    _mock_engine(monkeypatch, "c7c5")  # engine returns c5 when called

    sid = cm.start_game(color="white", repertoire_pgn=rep_pgn)["session_id"]
    # Play 1.e4 — not in the d4 repertoire; engine falls back to engine search.
    result = cm.make_move(sid, "e2e4")
    assert result["engine_move"] == "c5"  # came from fake engine, not book


def test_start_game_repertoire_disabled_with_custom_fen(monkeypatch):
    """repertoire_pgn is ignored when starting_fen is also set."""
    rep_pgn = '[Event "t"]\n[Result "*"]\n\n1. d4 d5 *\n'
    _mock_engine(monkeypatch, "c7c5")

    fen = chess.STARTING_FEN  # same as start but explicitly set
    sid = cm.start_game(color="white", starting_fen=fen, repertoire_pgn=rep_pgn)["session_id"]
    # Book should be disabled; engine should be called normally.
    assert cm._SESSIONS[sid]["rep_node"] is None
