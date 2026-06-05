#!/usr/bin/env python3
from mcp.server.fastmcp import FastMCP
from functools import lru_cache
from typing import Literal
import chess
import chess.pgn
import chess.engine
import io
import math
import os

import structure
import repertoire
import openings

ENGINE_PATH = os.environ.get("STOCKFISH_PATH", "/usr/bin/stockfish")
DEFAULT_DEPTH = int(os.environ.get("ANALYSIS_DEPTH", "18"))
_GAP_DEFAULT_DEPTH = 20  # gap tool uses depth 20 — depth 18 showed 26 cp discrepancy vs depth 20
DEFAULT_MULTIPV = 3

MAX_PGN_BYTES = int(os.environ.get("MAX_PGN_BYTES", "100000"))
MAX_REPERTOIRE_BYTES = int(os.environ.get("MAX_REPERTOIRE_BYTES", "1000000"))
MAX_LINE_MOVES = int(os.environ.get("MAX_LINE_MOVES", "500"))
MIN_DEPTH, MAX_DEPTH = 1, 30
MIN_TIME, MAX_TIME = 0.01, float(os.environ.get("MAX_ENGINE_TIME_S", "60"))
MAX_MULTIPV = 10
MAX_COMPARE_MOVES = MAX_MULTIPV  # compare_moves searches one line per candidate
MAX_GAP_POSITIONS = 60  # find_repertoire_gaps engine-pass ceiling


def _clamp_depth(depth: int) -> int:
    return max(MIN_DEPTH, min(MAX_DEPTH, depth))


def _clamp_time(time_limit: float) -> float:
    return max(MIN_TIME, min(MAX_TIME, time_limit))


def _limit(depth: int, time_limit: float | None) -> chess.engine.Limit:
    """Engine search limit: by wall-clock when time_limit is set, else by depth.

    Depth is the reproducible default; time-based search is wall-clock dependent (not
    bit-reproducible across runs/hardware) but useful on slow hardware or for fast iteration.
    """
    if time_limit is not None:
        return chess.engine.Limit(time=time_limit)
    return chess.engine.Limit(depth=depth)


def _pgn_too_large(pgn: str) -> dict | None:
    if len(pgn.encode("utf-8")) > MAX_PGN_BYTES:
        return {
            "error": "pgn_too_large",
            "reason": f"PGN exceeds {MAX_PGN_BYTES} bytes",
        }
    return None


mcp = FastMCP(
    "chess-analysis",
    host=os.environ.get("FASTMCP_HOST", "127.0.0.1"),
    port=int(os.environ.get("FASTMCP_PORT", "8000")),
)


def _score_cp(pov_score: chess.engine.PovScore) -> int:
    """Centipawns from white's POV. Mate → ±10000."""
    s = pov_score.white()
    if s.is_mate():
        return 10000 if s.mate() > 0 else -10000
    return s.score()


def _score_with_type(pov_score: chess.engine.PovScore) -> tuple:
    """Returns (cp_white_pov, score_type, mate_in) for evaluate_position."""
    s = pov_score.white()
    if s.is_mate():
        mate = s.mate()
        return (10000 if mate > 0 else -10000, "mate", mate)
    return (s.score(), "cp", None)


def _classify(cp_loss: int) -> str:
    """Classify a move by cp_loss: blunder (>200) > mistake (>100) > inaccuracy (>50) > good."""
    if cp_loss > 200:
        return "blunder"
    if cp_loss > 100:
        return "mistake"
    if cp_loss > 50:
        return "inaccuracy"
    return "good"


def _move_accuracy(cp_loss: int) -> float:
    """Per-move accuracy in [0, 1] from centipawn loss: 1.0 at no loss, decaying smoothly.

    A monotonic heuristic (exponential decay) — averaged across a side's moves and scaled
    to a percentage for get_game_summary's accuracy_pct. Not an engine win-probability model.
    """
    return math.exp(-max(0, cp_loss) / 300.0)


def _pv_san(board: chess.Board, pv: list[chess.Move]) -> str:
    """Convert PV move list to SAN string, up to 5 moves."""
    b = board.copy()
    parts = []
    for move in pv[:5]:
        parts.append(b.san(move))
        b.push(move)
    return " ".join(parts)


def _parse_game(pgn: str) -> chess.pgn.Game:
    """Parse PGN into a game tree, validating it has moves."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or game.next() is None:
        raise ValueError("PGN contains no moves")
    return game


def _path_of(node, board_by_node: dict) -> tuple[str, ...]:
    """SAN route from the root to `node`, using precomputed parent boards.

    A node's SAN path is its stable identity across re-parses of the same PGN — the key the
    cached tree analysis is stored under, so export_annotated_pgn can look records up against
    a fresh game it owns and is free to mutate (the cached game must stay untouched).
    """
    moves: list[str] = []
    while node.parent is not None:
        moves.append(board_by_node[node.parent].san(node.move))
        node = node.parent
    moves.reverse()
    return tuple(moves)


def _analyze_tree_nodes(
    game: chess.pgn.Game,
    engine: chess.engine.SimpleEngine,
    limit: chess.engine.Limit,
    multipv: int,
) -> dict[tuple[str, ...], dict]:
    """Analyze EVERY node in the game tree (mainline + variations) in one pass.

    Each distinct position (root included) is analyzed exactly once; a move-node's record
    draws eval_before / best_move / alternatives from its parent's analysis and eval_after
    from its own. Returns {san_path: record}; each record matches the mainline record shape.
    Pure function of game + engine + limit + multipv; engine IO is the caller's.
    """
    board_by_node: dict = {}
    info_by_node: dict = {}
    for node in [game, *repertoire.iter_nodes(game)]:
        board = node.board()
        board_by_node[node] = board
        info_by_node[node] = engine.analyse(board, limit, multipv=multipv)

    records: dict[tuple[str, ...], dict] = {}
    for node in repertoire.iter_nodes(game):
        pboard = board_by_node[node.parent]
        parent_infos = info_by_node[node.parent]
        top = parent_infos[0]
        color = "white" if pboard.turn == chess.WHITE else "black"
        eval_before = _score_cp(top["score"])
        eval_after = _score_cp(info_by_node[node][0]["score"])
        cp_loss = (
            (eval_before - eval_after)
            if color == "white"
            else (eval_after - eval_before)
        )
        best_move = top["pv"][0] if top.get("pv") else node.move

        records[_path_of(node, board_by_node)] = {
            "move_number": pboard.fullmove_number,
            "color": color,
            "move": pboard.san(node.move),
            "cp_loss": max(0, cp_loss),
            "classification": _classify(max(0, cp_loss)),
            "eval_before": eval_before,
            "eval_after": eval_after,
            "best_move": pboard.san(best_move),
            "best_pv": _pv_san(pboard, top.get("pv", [])),
            "alternatives": [
                {"move": pboard.san(ai["pv"][0]), "eval": _score_cp(ai["score"])}
                for ai in parent_infos[1:]
                if ai.get("pv")
            ],
            "fen": pboard.fen(),
        }
    return records


@lru_cache(maxsize=32)
def _analyse_tree(
    pgn: str, depth: int, multipv: int, time_limit: float | None
) -> tuple[dict[tuple[str, ...], dict], chess.pgn.Game]:
    """Engine pass over the whole game tree. Returns ({san_path: record}, game).

    Cached by (pgn, depth, multipv, time_limit). The map and game are READ-ONLY for callers
    (export_annotated_pgn re-parses its own mutable game and looks records up by path). One
    pass feeds both the mainline game tools and the annotated-PGN export.
    """
    game = _parse_game(pgn)
    limit = _limit(depth, time_limit)
    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        records = _analyze_tree_nodes(game, engine, limit, multipv)
    return records, game


def _analyse_all_moves(
    pgn: str, depth: int, multipv: int, time_limit: float | None
) -> tuple[list[dict], chess.pgn.Game]:
    """Mainline move records (in order), projected from the cached whole-tree analysis.

    Drop-in for the former mainline-only pass: get_game_summary, analyze_game, and
    get_position consume this and are unaffected by the tree generalization. Bad PGN raises
    ValueError (from _parse_game) for the tools to map to invalid_pgn.
    """
    records_by_path, game = _analyse_tree(pgn, depth, multipv, time_limit)
    mainline: list[dict] = []
    board = game.board()
    node = game
    path: list[str] = []
    while node.variations:
        child = node.variations[0]
        path.append(board.san(child.move))
        board.push(child.move)
        mainline.append(records_by_path[tuple(path)])
        node = child
    return mainline, game


# The lean mistake entry — shared by analyze_game's list and get_game_summary's worst_moves
# so the public shape is defined once.
_LEAN_FIELDS = (
    "move_number",
    "color",
    "move",
    "cp_loss",
    "classification",
    "best_move",
)


def _lean_move(r: dict) -> dict:
    return {k: r[k] for k in _LEAN_FIELDS}


@mcp.tool()
def analyze_game(
    pgn: str,
    depth: int = DEFAULT_DEPTH,
    min_cp_loss: int = 50,
    verbose: bool = False,
    time_limit: float | None = None,
) -> list[dict] | dict:
    """
    Mistakes in a PGN game: moves where cp_loss >= min_cp_loss (default 50 =
    inaccuracies and worse). min_cp_loss=0 → all moves.

    Entry (lean default): move_number, color, move, cp_loss, classification,
    best_move. cp_loss = centipawns worse than best play, white-POV.
    verbose=True adds eval_after (position eval, white-POV) + best_pv (refutation, SAN).

    time_limit (seconds, optional) searches by wall-clock instead of depth (depth is then
    ignored) — for slow hardware or fast iteration; depth is the reproducible default.

    Call get_game_summary first for overview. Drill one mistake (FEN, alternatives,
    full line) via get_position(move_number, color). Bad input → {"error","reason"}.
    """
    if err := _pgn_too_large(pgn):
        return err
    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    try:
        records, _ = _analyse_all_moves(pgn, depth, DEFAULT_MULTIPV, time_limit)
    except ValueError as e:
        return {"error": "invalid_pgn", "reason": str(e)}

    out = []
    for r in records:
        if r["cp_loss"] < min_cp_loss:
            continue
        entry = _lean_move(r)
        if verbose:
            entry["eval_after"] = r["eval_after"]
            entry["best_pv"] = r["best_pv"]
        out.append(entry)
    return out


@mcp.tool()
def get_game_summary(
    pgn: str, depth: int = DEFAULT_DEPTH, time_limit: float | None = None
) -> dict:
    """
    Overview of a PGN game, no per-move detail. Call this first.

    Returns: opening (PGN headers, else null), total_moves (all analyzed moves,
    both sides), per-side white/black {blunders, mistakes, inaccuracies, good_moves,
    accuracy_pct}, worst_moves (top 3 by cp_loss, each: move_number, color, move,
    cp_loss, classification, best_move).

    time_limit (seconds, optional) searches by wall-clock instead of depth (depth then
    ignored) — for slow hardware or fast iteration; depth is the reproducible default.

    Drill any worst_move via get_position(pgn, move_number, color).
    Bad input → {"error","reason"}.
    """
    if err := _pgn_too_large(pgn):
        return err
    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    try:
        records, game = _analyse_all_moves(pgn, depth, DEFAULT_MULTIPV, time_limit)
    except ValueError as e:
        return {"error": "invalid_pgn", "reason": str(e)}

    headers = game.headers
    opening = headers.get("Opening") or headers.get("ECO") or None

    stats: dict[str, dict] = {
        "white": {
            "blunder": 0,
            "mistake": 0,
            "inaccuracy": 0,
            "good": 0,
            "_acc_sum": 0.0,
            "_count": 0,
        },
        "black": {
            "blunder": 0,
            "mistake": 0,
            "inaccuracy": 0,
            "good": 0,
            "_acc_sum": 0.0,
            "_count": 0,
        },
    }

    for r in records:
        s = stats[r["color"]]
        s[r["classification"]] += 1
        s["_acc_sum"] += _move_accuracy(r["cp_loss"])
        s["_count"] += 1

    def _side_summary(s: dict) -> dict:
        count = s["_count"]
        accuracy = round(s["_acc_sum"] / count * 100, 1) if count else None
        return {
            "blunders": s["blunder"],
            "mistakes": s["mistake"],
            "inaccuracies": s["inaccuracy"],
            "good_moves": s["good"],
            "accuracy_pct": accuracy,
        }

    worst_3 = sorted(records, key=lambda r: r["cp_loss"], reverse=True)[:3]

    return {
        "opening": opening,
        "total_moves": len(records),
        "white": _side_summary(stats["white"]),
        "black": _side_summary(stats["black"]),
        "worst_moves": [_lean_move(r) for r in worst_3],
    }


@mcp.tool()
def get_position(
    pgn: str,
    move_number: int,
    color: str,
    depth: int = DEFAULT_DEPTH,
    time_limit: float | None = None,
) -> dict:
    """
    Detail for one move — drill-down companion to get_game_summary and analyze_game.
    Identify move by move_number + color ("white"/"black") from those tools.

    Returns: fen (position with `color` to move; pass to evaluate_position/
    validate_line/get_legal_moves), eval_cp (position eval, white-POV centipawns),
    move_played (SAN), best_move (SAN), best_pv (best line, SAN), alternatives
    (top engine replies, each {move, eval}).

    time_limit (seconds, optional) searches by wall-clock instead of depth (depth then
    ignored) — for slow hardware or fast iteration; depth is the reproducible default.

    Bad input or no such move → {"error","reason"}.
    """
    if color not in ("white", "black"):
        return {"error": "invalid_color", "reason": "color must be 'white' or 'black'"}
    if err := _pgn_too_large(pgn):
        return err
    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    try:
        records, _ = _analyse_all_moves(pgn, depth, DEFAULT_MULTIPV, time_limit)
    except ValueError as e:
        return {"error": "invalid_pgn", "reason": str(e)}

    for r in records:
        if r["move_number"] == move_number and r["color"] == color:
            return {
                "fen": r["fen"],
                "eval_cp": r["eval_before"],
                "move_played": r["move"],
                "best_move": r["best_move"],
                "best_pv": r["best_pv"],
                "alternatives": r["alternatives"],
            }
    return {
        "error": "move_not_found",
        "reason": f"no {color} move {move_number} in game",
    }


@mcp.tool()
def evaluate_position(
    fen: str,
    depth: int = DEFAULT_DEPTH,
    multipv: int = 1,
    time_limit: float | None = None,
) -> dict:
    """
    Evaluate one position by FEN with Stockfish.

    Returns: score_cp (white-POV centipawns; ±10000 = mate), score_type
    ("cp"|"mate"), mate_in (signed mate distance, else null), best_move (SAN),
    pv (best line, SAN), depth (search depth reached).
    multipv>1 (max 10) adds candidates: top-N ranked moves, each
    {move (SAN), eval (white-POV cp), pv (SAN)} — use to compare options or
    explore opponent deviations (repertoire work).
    time_limit (seconds, optional) searches by wall-clock instead of depth (depth then
    ignored) — for slow hardware or fast iteration; depth is the reproducible default.
    Pass a FEN from an MCP result (validate_fen / get_position / get_structural_profile /
    validate_line), not one typed from memory. Invalid FEN → {"error","reason"}.
    """
    depth = _clamp_depth(depth)
    multipv = max(1, min(MAX_MULTIPV, multipv))
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"error": "invalid_fen", "reason": str(e)}

    limit = _limit(depth, time_limit)
    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        if multipv > 1:
            infos = engine.analyse(board, limit, multipv=multipv)
        else:
            infos = [engine.analyse(board, limit)]

    top = infos[0]
    pv = top.get("pv", [])
    best_move = board.san(pv[0]) if pv else None
    cp, score_type, mate_in = _score_with_type(top["score"])

    result = {
        "score_cp": cp,
        "score_type": score_type,
        "mate_in": mate_in,
        "best_move": best_move,
        "pv": _pv_san(board, pv),
        "depth": top.get("depth", depth),
    }
    if multipv > 1:
        result["candidates"] = [
            {
                "move": board.san(info["pv"][0]),
                "eval": _score_cp(info["score"]),
                "pv": _pv_san(board, info["pv"]),
            }
            for info in infos
            if info.get("pv")
        ]
    return result


@mcp.tool()
def validate_line(fen: str, moves: list[str]) -> dict:
    """
    Check whether a move sequence (UCI or SAN) is legal from a position.
    Ground any line before stating it.

    Success: {valid: true, moves_validated, final_fen}.
    Failure: {valid: false, error_at_index, error_move, reason, fen_at_error}
    (fen_at_error = position where the bad move was attempted).
    Invalid FEN → {"error","reason"}.
    """
    if len(moves) > MAX_LINE_MOVES:
        return {
            "error": "too_many_moves",
            "reason": f"line exceeds {MAX_LINE_MOVES} moves",
        }
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"error": "invalid_fen", "reason": str(e)}

    for i, move_str in enumerate(moves):
        try:
            move = board.parse_uci(move_str)
        except ValueError:
            try:
                move = board.parse_san(move_str)
            except ValueError:
                return {
                    "valid": False,
                    "error_at_index": i,
                    "error_move": move_str,
                    "reason": "parse error — not valid UCI or SAN",
                    "fen_at_error": board.fen(),
                }

        if move not in board.legal_moves:
            return {
                "valid": False,
                "error_at_index": i,
                "error_move": move_str,
                "reason": "illegal move in this position",
                "fen_at_error": board.fen(),
            }

        board.push(move)

    return {"valid": True, "moves_validated": len(moves), "final_fen": board.fen()}


@mcp.tool()
def get_legal_moves(fen: str, uci: bool = False) -> dict:
    """
    List every legal move from a position. Pick a grounded move, don't guess.
    Pass a FEN from an MCP result (validate_fen / get_position / ...), not a hand-built one.

    Returns: turn ("white"|"black"), move_count, moves. Default moves =
    space-separated SAN string ("Nf3 Nc3 e4 ..."). uci=True → list of {uci, san}
    (use when you need UCI strings).
    Invalid FEN → {"error","reason"}.
    """
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"error": "invalid_fen", "reason": str(e)}

    legal = list(board.legal_moves)
    turn = "white" if board.turn == chess.WHITE else "black"

    if uci:
        moves: object = [{"uci": m.uci(), "san": board.san(m)} for m in legal]
    else:
        moves = " ".join(board.san(m) for m in legal)

    return {"turn": turn, "move_count": len(legal), "moves": moves}


def _fen_status_reason(status: chess.Status) -> str:
    """Human reason for an illegal-but-parseable position (board.status() != STATUS_VALID)."""
    flags = [
        s.name.removeprefix("STATUS_").lower()
        for s in chess.Status
        if s.value and (status & s)
    ]
    return ", ".join(flags) or "illegal position"


@mcp.tool()
def validate_fen(fen: str) -> dict:
    """
    Validate a FEN before using it. Call on ANY user-supplied FEN before analysis, then use the
    returned (normalized) fen downstream — never the raw input. Engine-free.

    Checks syntax AND legality (board.status()): an illegal-but-parseable position (two kings,
    side-not-to-move in check, ...) is rejected, not silently passed to the engine.

    valid:true → {valid, fen (NORMALIZED — pass this to other tools), side_to_move
    ("white"/"black"), is_game_over}. valid:false → {valid:false, error:"invalid_fen", reason}.
    """
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"valid": False, "error": "invalid_fen", "reason": str(e)}
    if board.status() != chess.STATUS_VALID:
        return {
            "valid": False,
            "error": "invalid_fen",
            "reason": _fen_status_reason(board.status()),
        }
    return {
        "valid": True,
        "fen": board.fen(),
        "side_to_move": "white" if board.turn == chess.WHITE else "black",
        "is_game_over": board.is_game_over(),
    }


@mcp.tool()
def compare_moves(
    fen: str,
    moves: list[str],
    depth: int = DEFAULT_DEPTH,
    time_limit: float | None = None,
) -> dict:
    """
    Rank YOUR OWN candidate moves from a position, best→worst. Unlike evaluate_position
    (which ranks the engine's top moves), this scores the exact moves you pass — even ones
    the engine wouldn't pick — so you can compare options you are actually weighing.

    moves = candidate moves (UCI or SAN). Returns: fen, side_to_move ("white"/"black"),
    results (each: move SAN, eval white-POV cp, cp_loss = centipawns worse than the best of
    YOUR candidates from the mover's POV (best = 0), pv best line SAN), illegal (any inputs
    that were not legal moves here, echoed back). Results sorted best first.

    time_limit (seconds, optional) searches by wall-clock instead of depth (depth then
    ignored); depth is the reproducible default. More than 10 moves → too_many_moves;
    invalid FEN → invalid_fen. Bad input → {"error","reason"}.
    """
    if len(moves) > MAX_COMPARE_MOVES:
        return {
            "error": "too_many_moves",
            "reason": f"compare at most {MAX_COMPARE_MOVES} moves",
        }
    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"error": "invalid_fen", "reason": str(e)}

    valid: list[chess.Move] = []
    illegal: list[str] = []
    for move_str in moves:
        try:
            move = board.parse_uci(move_str)
        except ValueError:
            try:
                move = board.parse_san(move_str)
            except ValueError:
                illegal.append(move_str)  # not valid UCI or SAN
                continue
        if move not in board.legal_moves:
            illegal.append(move_str)  # parsed but not legal here
            continue
        if move not in valid:
            valid.append(move)  # drop duplicate candidates silently

    side = "white" if board.turn == chess.WHITE else "black"
    if not valid:
        return {
            "fen": board.fen(),
            "side_to_move": side,
            "results": [],
            "illegal": illegal,
        }

    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        infos = engine.analyse(
            board, _limit(depth, time_limit), multipv=len(valid), root_moves=valid
        )

    def _mover_cp(info: dict) -> int:
        cp = _score_cp(info["score"])  # white-POV
        return cp if board.turn == chess.WHITE else -cp

    best = _mover_cp(infos[0]) if infos else 0
    results = [
        {
            "move": board.san(info["pv"][0]),
            "eval": _score_cp(info["score"]),
            "cp_loss": max(0, best - _mover_cp(info)),
            "pv": _pv_san(board, info["pv"]),
        }
        for info in infos
        if info.get("pv")
    ]
    return {
        "fen": board.fen(),
        "side_to_move": side,
        "results": results,
        "illegal": illegal,
    }


# ---------------------------------------------------------------------------
# Repertoire tools — stateful (handle) layer. See REPERTOIRE_DESIGN.md.
# load_repertoire parses once and caches; the rest accept the repertoire_id handle.
# All but suggest_complementary_lines are engine-free (static structural analysis).
# ---------------------------------------------------------------------------


@mcp.tool()
def load_repertoire(pgn: str, color: Literal["white", "black"]) -> dict:
    """
    Parse a repertoire PGN ONCE, cache it, and return a handle. A repertoire is a tree
    of variations (not one game) — re-sending the full PGN on every call wastes input
    tokens, so all other repertoire tools take the returned repertoire_id instead.

    Cheap: tree stats only, no engine. Returns: repertoire_id (pass to the other
    repertoire tools), color ("white"/"black"), nodes (move-nodes in the tree), leaves
    (variation ends), max_depth (deepest line, in plies).

    Then: get_structural_profile (themes), analyze_repertoire_congruence (consistency),
    suggest_complementary_lines (extensions). Handle expires after idle TTL → reload.
    Bad input → {"error","reason"}.
    """
    if len(pgn.encode("utf-8")) > MAX_REPERTOIRE_BYTES:
        return {
            "error": "pgn_too_large",
            "reason": f"repertoire PGN exceeds {MAX_REPERTOIRE_BYTES} bytes",
        }
    if color not in ("white", "black"):
        return {"error": "invalid_color", "reason": "color must be 'white' or 'black'"}
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or game.next() is None:
        return {"error": "invalid_pgn", "reason": "PGN contains no moves"}
    color_bool = chess.WHITE if color == "white" else chess.BLACK
    return repertoire.store_repertoire(game, color_bool)


@mcp.tool()
def get_structural_profile(
    repertoire_id: str,
    variation_path: list[str] | None = None,
) -> dict:
    """
    Static pawn-structure profile of a repertoire. Engine-free. Identifies the themes a
    repertoire is built on so they can be cross-referenced programmatically.

    variation_path = SAN move list addressing one node (e.g. ["e4","c5","Nf3"]); each
    SAN must match a move in the tree. Then returns one position: fen, structure_class
    (one of 22 canonical pawn structures — IQP, Carlsbad, Maroczy, French, Stonewall,
    King's Indian, Benoni, Closed Sicilian, Hanging pawns, Caro-Kann, Slav, Grünfeld
    Centre, Nimzo-Grünfeld, Hedgehog, Najdorf, Scheveningen, Symmetric Benoni, Lopez,
    Benko, English Fianchetto, Réti/KIA, Symmetrical English — or unknown), confidence,
    center (locked/tense/open/semi-open),
    primitives {doubled, isolated, passed, chains}, half_open_files, open_files, and
    themes (always-on descriptors: fianchetto_white/black, space_white/black,
    wing_majority_white/black, minority_attack_white/black, flank_vs_center,
    color_complex) — themes carry signal even when structure_class is unknown.

    variation_path = null (default) → AGGREGATE fingerprint over all leaves: structures
    (each {structure_class, count, avg_confidence}), themes (leaf-count per structural
    theme — fianchetto/minority_attack/flank_vs_center/double_fianchetto/wing_majority/
    color_complex + avg_space_white/black; surfaces the DNA of leaves that classify as
    unknown, e.g. fianchetto systems), center_distribution, common_open_files,
    common_half_open_files.

    Get repertoire_id from load_repertoire; drill the paths reported by
    analyze_repertoire_congruence. Bad input → {"error","reason"}.
    """
    rep = repertoire.get_repertoire(repertoire_id)
    if rep is None:
        return {
            "error": "repertoire_not_found",
            "reason": "unknown or expired repertoire_id; call load_repertoire",
        }
    if variation_path is None:
        return repertoire.aggregate_profile(rep)
    node = repertoire.resolve_path(rep.game, variation_path)
    if node is None:
        return {
            "error": "variation_not_found",
            "reason": "variation_path does not match a line in the repertoire",
        }
    profile = structure.position_profile(node.board(), rep.color)
    profile["opening"] = openings.identify(node.board())  # {eco, name} or null
    return profile


@mcp.tool()
def analyze_repertoire_congruence(
    repertoire_id: str,
    min_severity: Literal["low", "medium", "high"] = "medium",
    limit: int = 10,
    acknowledged_weaknesses: list[list[str]] | None = None,
) -> dict:
    """
    Flag logical/thematic incongruencies across a repertoire's lines. Engine-free.

    Checks: structure_outlier (a line veers off the repertoire's dominant structure →
    extra middlegame plan to learn), weakness_inconsistency (a line accepts doubled/
    isolated pawns against the repertoire's otherwise-clean grain), center_inconsistency
    (the repertoire is split between locking and opening the center).

    acknowledged_weaknesses = list of variation_paths (each a SAN move list, same format
    as the paths field in congruence output) for known positional systems where the
    structural weakness is intentional. Matching weakness_inconsistency flags are
    downgraded to severity "low" with acknowledged:true instead of surfacing as "medium".

    Returns: total_flagged, leaves_analyzed, by_type (counts), incongruencies (each:
    type, severity, description, paths = the SAN variation_path(s) — feed a path to
    get_structural_profile to inspect that exact position; acknowledged:true when
    suppressed by acknowledged_weaknesses). Filtered to min_severity and capped to limit
    (default 10, max 50). Bad input → {"error","reason"}.
    """
    rep = repertoire.get_repertoire(repertoire_id)
    if rep is None:
        return {
            "error": "repertoire_not_found",
            "reason": "unknown or expired repertoire_id; call load_repertoire",
        }
    limit = max(1, min(50, limit))
    return repertoire.analyze_congruence(rep, min_severity, limit, acknowledged_weaknesses)


@mcp.tool()
def get_transpositions(repertoire_id: str, limit: int = 20) -> dict:
    """
    Positions the repertoire reaches by more than one move order (transpositions). Engine-free.

    Useful for study efficiency: converging lines mean one move order can cover several. Returns
    total (count of converging positions) and transpositions (each: fen, paths = the SAN
    variation_paths that reach it), largest groups first, capped to limit (default 20, max 100).
    Empty if the tree never transposes. Bad input → {"error","reason"}.
    """
    rep = repertoire.get_repertoire(repertoire_id)
    if rep is None:
        return {
            "error": "repertoire_not_found",
            "reason": "unknown or expired repertoire_id; call load_repertoire",
        }
    limit = max(1, min(100, limit))
    groups = repertoire.find_transpositions(rep.game)
    return {"total": len(groups), "transpositions": groups[:limit]}


@mcp.tool()
def get_repertoire_coverage(repertoire_id: str, limit: int = 20) -> dict:
    """
    Tree-shape hygiene of a repertoire. Engine-free. Finds where the tree is structurally
    incomplete, independent of move quality (use find_repertoire_gaps for engine criticality).

    Headline: dangling_lines — leaves where it is YOUR turn to move, so the line stops exactly
    where a prepared move is owed (a real hole to fill). Leaves where the opponent is to move
    are natural frontiers (you played, paused) → counted as frontier_count, not flagged.

    Returns: color, leaves (total), dangling_count, dangling_lines (each: path = SAN
    variation_path for drill-down, ply), frontier_count, max_depth, shallowest_leaf_ply (the
    earliest a line stops — an extension candidate). dangling_lines capped to limit (default
    20, max 100). Bad input → {"error","reason"}.
    """
    rep = repertoire.get_repertoire(repertoire_id)
    if rep is None:
        return {
            "error": "repertoire_not_found",
            "reason": "unknown or expired repertoire_id; call load_repertoire",
        }
    limit = max(1, min(100, limit))
    report = repertoire.coverage_report(rep, limit)
    report["color"] = "white" if rep.color == chess.WHITE else "black"
    return report


@mcp.tool()
def suggest_complementary_lines(
    repertoire_id: str,
    fen: str,
    mode: Literal["low_memorization", "sharp"] = "low_memorization",
    depth: int = DEFAULT_DEPTH,
    limit: int = 5,
    time_limit: float | None = None,
) -> dict:
    """
    Suggest continuations from an anchor position (fen), ranked to fit the user's
    structural profile or to break from it. Uses the engine for a soundness floor, then
    re-ranks by mode.

    fen = position to suggest a move FROM (a repertoire leaf, or a gap). The
    repertoire_id supplies the structural profile to match/contrast against.
    mode "low_memorization" → moves whose resulting structure the user ALREADY plays
    elsewhere (least new theory), ranked by profile_match [0,1]. mode "sharp" → maximally
    unbalanced/novel structures, ranked by a sharpness heuristic.

    Returns: mode, anchor_fen, suggestions (each: move SAN, resulting_structure, eval
    (white-POV cp), pv, and profile_match or sharpness). limit default 5, max 10.
    time_limit (seconds, optional) searches by wall-clock instead of depth (depth then
    ignored); depth is the reproducible default. Bad input → {"error","reason"}.
    """
    rep = repertoire.get_repertoire(repertoire_id)
    if rep is None:
        return {
            "error": "repertoire_not_found",
            "reason": "unknown or expired repertoire_id; call load_repertoire",
        }
    if mode not in ("low_memorization", "sharp"):
        return {
            "error": "invalid_mode",
            "reason": "mode must be 'low_memorization' or 'sharp'",
        }
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"error": "invalid_fen", "reason": str(e)}
    if board.is_game_over():
        return {"mode": mode, "anchor_fen": board.fen(), "suggestions": []}

    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    limit = max(1, min(MAX_MULTIPV, limit))
    pool = min(
        MAX_MULTIPV, limit + 2
    )  # extra candidates so the soundness floor has slack
    mover = board.turn

    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        infos = engine.analyse(board, _limit(depth, time_limit), multipv=pool)

    def _mover_cp(info: dict) -> int:
        cp = _score_cp(info["score"])  # white-POV
        return cp if mover == chess.WHITE else -cp

    best_cp = _mover_cp(infos[0]) if infos else 0
    shares = repertoire.profile_structure_shares(rep)
    ranked: list[tuple[dict, int]] = []

    for info in infos:
        pv = info.get("pv")
        if not pv:
            continue
        move = pv[0]
        mcp = _mover_cp(info)
        if best_cp - mcp > 100:  # unsound relative to the best move → skip
            continue
        after = board.copy()
        after.push(move)
        result_struct = structure.classify_structure(after)["structure_class"]
        entry = {
            "move": board.san(move),
            "resulting_structure": result_struct,
            "eval": _score_cp(info["score"]),
            "pv": _pv_san(board, pv),
        }
        if mode == "low_memorization":
            # Don't credit unknown→unknown as familiarity: an unclassified resulting
            # structure carries no signal about plans the user already knows.
            match = (
                0.0 if result_struct == "unknown" else shares.get(result_struct, 0.0)
            )
            entry["profile_match"] = round(match, 2)
        else:
            imbalance = sum(
                len(fn(after, c))
                for fn in (
                    structure.get_isolated_pawns,
                    structure.get_doubled_pawns,
                    structure.get_passed_pawns,
                )
                for c in (chess.WHITE, chess.BLACK)
            )
            novelty = 0.0 if result_struct in shares else 1.0
            entry["sharpness"] = round(abs(mcp) / 100.0 + 0.5 * imbalance + novelty, 2)
        ranked.append((entry, mcp))

    if mode == "low_memorization":
        ranked.sort(key=lambda t: (-t[0]["profile_match"], -t[1]))
    else:
        ranked.sort(key=lambda t: -t[0]["sharpness"])

    return {
        "mode": mode,
        "anchor_fen": board.fen(),
        "suggestions": [entry for entry, _ in ranked[:limit]],
    }


@mcp.tool()
def suggest_replacement_line(
    repertoire_id: str,
    outlier_variation_path: list[str],
    mode: Literal["structural_fit", "low_memorization", "solid"] = "structural_fit",
    depth: int = DEFAULT_DEPTH,
    time_limit: float | None = None,
) -> dict:
    """
    Single-call replacement for an incongruent repertoire line. Given the variation_path
    of a flagged line (from analyze_repertoire_congruence), finds the last user move in
    that line, identifies the opponent move it was answering (anchored_to), then suggests
    sound alternatives with full engine-validated continuations.

    Replaces an 8-step manual chain (validate_line → evaluate_position →
    suggest_complementary_lines → validate_line across ~8 moves) with one call.

    mode "structural_fit" / "low_memorization" → alternatives ranked by how well the
    resulting structure matches the existing repertoire (profile_match [0,1]).
    mode "solid" → alternatives ranked by eval (best-evaluated first).

    Returns: outlier_move (the user move being replaced), anchored_to (the opponent move
    that triggered this line), suggestions (each: pivot_move, line = full SAN continuation,
    eval_cp white-POV, resulting_structure, profile_match). Bad input → {"error","reason"}.
    """
    rep = repertoire.get_repertoire(repertoire_id)
    if rep is None:
        return {
            "error": "repertoire_not_found",
            "reason": "unknown or expired repertoire_id; call load_repertoire",
        }
    if mode not in ("structural_fit", "low_memorization", "solid"):
        return {
            "error": "invalid_mode",
            "reason": "mode must be 'structural_fit', 'low_memorization', or 'solid'",
        }

    node = repertoire.resolve_path(rep.game, outlier_variation_path)
    if node is None:
        return {
            "error": "variation_not_found",
            "reason": "outlier_variation_path does not match a line in the repertoire",
        }

    # Walk up to find the last node where the USER played a move (the move to replace).
    # node.parent.board().turn == rep.color means rep.color made node.move.
    pivot_node = node
    while pivot_node.parent is not None:
        if pivot_node.parent.board().turn == rep.color:
            break
        pivot_node = pivot_node.parent

    if pivot_node.parent is None or pivot_node.parent.board().turn != rep.color:
        return {
            "error": "no_user_move",
            "reason": "outlier_variation_path contains no user move to replace",
        }

    pivot_board = pivot_node.parent.board()  # position where the user must choose
    outlier_uci = pivot_node.move.uci()

    # The opponent's last move = the move that triggered this line (what we're answering).
    anchor_path = repertoire.san_path(pivot_node.parent)
    anchored_to = anchor_path[-1] if anchor_path else None

    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)

    shares = repertoire.profile_structure_shares(rep)

    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        infos = engine.analyse(
            pivot_board, _limit(depth, time_limit), multipv=min(MAX_MULTIPV, 5)
        )

    def _mover_cp(info: dict) -> int:
        cp = _score_cp(info["score"])
        return cp if pivot_board.turn == chess.WHITE else -cp

    best_cp = _mover_cp(infos[0]) if infos else 0
    suggestions = []

    for info in infos:
        pv = info.get("pv")
        if not pv:
            continue
        move = pv[0]
        if move.uci() == outlier_uci:
            continue  # skip the exact move being replaced
        mcp = _mover_cp(info)
        if best_cp - mcp > 100:  # unsound relative to best → skip
            continue
        after = pivot_board.copy()
        after.push(move)
        result_struct = structure.classify_structure(after)["structure_class"]
        match = 0.0 if result_struct == "unknown" else shares.get(result_struct, 0.0)
        suggestions.append(
            {
                "pivot_move": pivot_board.san(move),
                "line": _pv_san(pivot_board, pv),
                "eval_cp": _score_cp(info["score"]),
                "resulting_structure": result_struct,
                "profile_match": round(match, 2),
                "_mcp": mcp,
            }
        )

    if mode == "solid":
        suggestions.sort(key=lambda s: -s["_mcp"])
    else:
        suggestions.sort(key=lambda s: (-s["profile_match"], -s["_mcp"]))

    for s in suggestions:
        del s["_mcp"]

    return {
        "outlier_move": pivot_board.san(pivot_node.move),
        "anchored_to": anchored_to,
        "suggestions": suggestions,
    }


# Gap severity: how close an uncovered opponent move is to their best reply (cp, opponent POV).
_GAP_HIGH_CP, _GAP_MED_CP = 30, 80
_GAP_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}


def _gaps_from_infos(
    board: chess.Board, infos: list, covered: set[str]
) -> list[tuple[dict, int]]:
    """Uncovered strong opponent replies at one position (pure; engine IO is the caller's).

    board: the opponent-to-move position. infos: its multipv analysis. covered: uci strings the
    repertoire already answers. Returns [(entry, mover_cp)] for each engine top move NOT in
    covered; entry = {uncovered_move SAN, eval white-POV cp, severity}. Severity is set by how
    close the move is to the opponent's best — a near-best uncovered move is the urgent hole.
    """
    if not infos:
        return []

    def _mover_cp(info: dict) -> int:
        cp = _score_cp(info["score"])  # white-POV
        return cp if board.turn == chess.WHITE else -cp

    best = _mover_cp(infos[0])
    gaps: list[tuple[dict, int]] = []
    for info in infos:
        pv = info.get("pv")
        if not pv or pv[0].uci() in covered:
            continue
        mcp = _mover_cp(info)
        loss = best - mcp
        severity = (
            "high"
            if loss <= _GAP_HIGH_CP
            else "medium"
            if loss <= _GAP_MED_CP
            else "low"
        )
        gaps.append(
            (
                {
                    "uncovered_move": board.san(pv[0]),
                    "eval": _score_cp(info["score"]),
                    "severity": severity,
                },
                mcp,
            )
        )
    return gaps


@mcp.tool()
def find_repertoire_gaps(
    repertoire_id: str,
    depth: int = _GAP_DEFAULT_DEPTH,
    min_severity: Literal["low", "medium", "high"] = "medium",
    limit: int = 10,
    max_positions: int = 20,
    time_limit: float | None = None,
) -> dict:
    """
    Engine completeness scan: where does the repertoire fail to answer a strong opponent move?
    Checks every position where the OPPONENT is to move and you ALREADY prepare >= 1 reply (an
    internal decision point — not an unextended frontier leaf), runs the engine, and flags top
    opponent moves you do not cover.

    Transposition-aware: positions reached by multiple move orders are deduplicated and
    their covered-move sets merged, so a move answered in one branch is not flagged as a
    gap in another. transposition_endpoints lists positions where this merging occurred.

    Returns: color, positions_scanned, total_gaps, gaps (each: path = SAN variation_path of the
    position to drill via get_structural_profile/suggest_complementary_lines, uncovered_move
    (SAN, opponent's), eval (white-POV cp after it), severity high/medium/low by how close it is
    to the opponent's best), transposition_endpoints (positions resolved by transposition — each
    {fen, paths}). Filtered to min_severity (default medium), gaps capped to limit
    (default 10, max 50). Scans at most max_positions decision points (default 20, max 60),
    shallowest first; depth defaults to 20 (higher than other tools — gap evals at depth 18 can
    diverge ~26 cp from depth 20); depth/time_limit tune each engine pass.
    Bad input → {"error","reason"}.
    """
    rep = repertoire.get_repertoire(repertoire_id)
    if rep is None:
        return {
            "error": "repertoire_not_found",
            "reason": "unknown or expired repertoire_id; call load_repertoire",
        }
    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    limit = max(1, min(50, limit))
    max_positions = max(1, min(MAX_GAP_POSITIONS, max_positions))
    nodes = repertoire.opponent_reply_nodes(rep)[:max_positions]

    transposition_endpoints = [
        {"fen": nd["board"].fen(), "paths": nd["transposition_paths"]}
        for nd in nodes
        if len(nd["transposition_paths"]) > 1
    ]

    floor = _GAP_SEVERITY_RANK[min_severity]
    multipv = min(MAX_MULTIPV, 5)  # enough breadth to surface a missed strong reply
    found: list[tuple[dict, int]] = []
    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        for nd in nodes:
            infos = engine.analyse(
                nd["board"], _limit(depth, time_limit), multipv=multipv
            )
            for entry, mcp in _gaps_from_infos(nd["board"], infos, nd["covered"]):
                if _GAP_SEVERITY_RANK[entry["severity"]] < floor:
                    continue
                found.append(({"path": nd["path"], **entry}, mcp))

    found.sort(key=lambda t: (-_GAP_SEVERITY_RANK[t[0]["severity"]], -t[1]))
    return {
        "color": "white" if rep.color == chess.WHITE else "black",
        "positions_scanned": len(nodes),
        "total_gaps": len(found),
        "gaps": [entry for entry, _ in found[:limit]],
        "transposition_endpoints": transposition_endpoints,
    }


@mcp.tool()
def identify_opening(pgn: str) -> dict:
    """
    Name the opening of a PGN by ECO code. Engine-free; uses a 3700-entry table
    (lichess-org/chess-openings). Walks the mainline and returns the DEEPEST named opening
    position it passes through — engines give evals, this gives the opening's name and plan label.

    Returns: eco (e.g. "C60"), name (e.g. "Ruy Lopez"), ply (half-moves in where it's reached);
    or {"opening": null} if no position matches a known opening. Use when PGN headers omit the
    opening. Bad input → {"error","reason"}.
    """
    if err := _pgn_too_large(pgn):
        return err
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or game.next() is None:
        return {"error": "invalid_pgn", "reason": "PGN contains no moves"}
    return openings.deepest_in_line(game) or {"opening": None}


_PGN_HEADER_KEYS = ("Event", "White", "Black", "Result", "Date")


@mcp.tool()
def validate_pgn(pgn: str) -> dict:
    """
    Validate a PGN before using it. Call on ANY user-supplied PGN before answering — if it comes
    back valid:false, stop and report; do not analyze or "fix" it. Engine-free.

    valid:true → {valid, mainline_plies (half-moves in the main line), has_variations (tree has
    side lines → use load_repertoire for repertoire work, else the game tools), headers (event,
    white, black, result, date, opening — present values only)}.
    valid:false → {valid:false, error:"invalid_pgn"|"pgn_too_large", reason}.
    """
    if err := _pgn_too_large(pgn):
        return {"valid": False, **err}
    try:
        game = _parse_game(pgn)
    except ValueError as e:
        return {"valid": False, "error": "invalid_pgn", "reason": str(e)}

    plies = 0
    node = game
    while node.variations:
        node = node.variations[0]
        plies += 1
    has_variations = any(
        len(n.variations) > 1 for n in [game, *repertoire.iter_nodes(game)]
    )
    headers = {
        k.lower(): game.headers[k]
        for k in _PGN_HEADER_KEYS
        if game.headers.get(k, "?") not in ("", "?")
    }
    if opening := (game.headers.get("Opening") or game.headers.get("ECO")):
        headers["opening"] = opening
    return {
        "valid": True,
        "mainline_plies": plies,
        "has_variations": has_variations,
        "headers": headers,
    }


# Move classification → PGN NAG glyph. Good moves get no glyph (kept clean).
_NAG_BY_CLASS = {
    "inaccuracy": chess.pgn.NAG_DUBIOUS_MOVE,  # ?!
    "mistake": chess.pgn.NAG_MISTAKE,  # ?
    "blunder": chess.pgn.NAG_BLUNDER,  # ??
}


@mcp.tool()
def export_annotated_pgn(
    pgn: str,
    depth: int = DEFAULT_DEPTH,
    min_cp_loss: int = 50,
    time_limit: float | None = None,
) -> dict:
    """
    Engine-annotated PGN artifact: NAG glyphs + inline eval comments on flagged moves,
    across the mainline AND every variation, in one engine pass. Importable into any board
    GUI — the grounded, server-side counterpart to the annotate-pgn skill.

    Moves with cp_loss >= min_cp_loss (default 50) get a glyph (?! inaccuracy, ? mistake,
    ?? blunder) and a comment (white-POV eval after the move + the engine's best move). Good
    moves are left clean so the artifact stays close to the input size. depth, time_limit,
    and min_cp_loss tune the pass exactly as in analyze_game.

    Returns: pgn (annotated PGN string — an artifact, not a reasoning primitive),
    moves_annotated (count of glyphed/commented moves). Bad input → {"error","reason"}.
    """
    if err := _pgn_too_large(pgn):
        return err
    depth = _clamp_depth(depth)
    if time_limit is not None:
        time_limit = _clamp_time(time_limit)
    try:
        records_by_path, _ = _analyse_tree(pgn, depth, DEFAULT_MULTIPV, time_limit)
    except ValueError as e:
        return {"error": "invalid_pgn", "reason": str(e)}

    # Annotate a FRESH parse — never the cached game — so the analysis cache stays read-only.
    game = _parse_game(pgn)
    annotated = 0
    for node in repertoire.iter_nodes(game):
        rec = records_by_path.get(tuple(repertoire.san_path(node)))
        if rec is None or rec["cp_loss"] < min_cp_loss:
            continue
        nag = _NAG_BY_CLASS.get(rec["classification"])
        if nag is not None:
            node.nags.add(nag)
        node.comment = f"{rec['eval_after'] / 100:+.2f} best {rec['best_move']}"
        annotated += 1

    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    return {"pgn": game.accept(exporter), "moves_annotated": annotated}


if __name__ == "__main__":
    # Transport: "sse" (default — networked, for the Docker/remote server) or "stdio"
    # (client spawns the server as a subprocess; the low-friction local path, no port).
    transport = os.environ.get("MCP_TRANSPORT", "sse")
    if transport not in ("sse", "stdio", "streamable-http"):
        transport = "sse"
    mcp.run(transport=transport)
