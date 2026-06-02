#!/usr/bin/env python3
from mcp.server.fastmcp import FastMCP
from functools import lru_cache
import chess
import chess.pgn
import chess.engine
import io
import os

ENGINE_PATH = os.environ.get("STOCKFISH_PATH", "/usr/bin/stockfish")
DEFAULT_DEPTH = int(os.environ.get("ANALYSIS_DEPTH", "18"))
DEFAULT_MULTIPV = 3

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


def _score_details(pov_score: chess.engine.PovScore) -> tuple:
    """Returns (cp_white_pov, score_type, mate_in)."""
    s = pov_score.white()
    if s.is_mate():
        mate = s.mate()
        return (10000 if mate > 0 else -10000, "mate", mate)
    return (s.score(), "cp", None)


def _classify(cp_loss: int) -> str:
    if cp_loss > 200:
        return "blunder"
    if cp_loss > 100:
        return "mistake"
    if cp_loss > 50:
        return "inaccuracy"
    return "good"


def _pv_san(board: chess.Board, pv: list[chess.Move]) -> str:
    """Convert PV move list to SAN string."""
    b = board.copy()
    parts = []
    for move in pv[:5]:
        parts.append(b.san(move))
        b.push(move)
    return " ".join(parts)


def _move_accuracy(cp_loss: int) -> float:
    """Per-move accuracy score [0, 1]. 0 cp_loss → 1.0, 400+ cp_loss → 0.0."""
    return max(0.0, 1.0 - cp_loss / 400.0)


@lru_cache(maxsize=32)
def _analyse_all_moves(
    pgn: str, depth: int, multipv: int
) -> tuple[list[dict], chess.pgn.Game]:
    """Run engine analysis on every move. Returns (move_records, game).

    Cached by (pgn, depth, multipv) so get_game_summary, analyze_game, and
    get_position share a single engine pass instead of re-analysing the game.
    Records are treated as read-only; callers must not mutate them.
    """
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ValueError("could not parse PGN")
    if game.next() is None:
        # python-chess returns an empty Game for unparseable text rather than None
        raise ValueError("PGN contains no moves")

    records = []
    board = game.board()

    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        prev_infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)
        prev_info = prev_infos[0]
        prev_cp = _score_cp(prev_info["score"])

        for node in game.mainline():
            move = node.move
            color = "white" if board.turn == chess.WHITE else "black"
            san = board.san(move)

            move_number = board.fullmove_number
            fen_before = board.fen()
            eval_before = prev_cp
            best_move = prev_info["pv"][0] if prev_info.get("pv") else move
            best_san = board.san(best_move)
            best_pv_str = _pv_san(board, prev_info.get("pv", []))

            alternatives = []
            for alt_info in prev_infos[1:]:
                if alt_info.get("pv"):
                    alt_move = alt_info["pv"][0]
                    alternatives.append({
                        "move": board.san(alt_move),
                        "eval": _score_cp(alt_info["score"]),
                    })

            board.push(move)
            infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)
            info = infos[0]
            after_cp = _score_cp(info["score"])

            cp_loss = (prev_cp - after_cp) if color == "white" else (after_cp - prev_cp)
            cp_loss = max(0, cp_loss)

            records.append({
                "move_number": move_number,
                "color": color,
                "move": san,
                "cp_loss": cp_loss,
                "classification": _classify(cp_loss),
                "eval_before": eval_before,
                "eval_after": after_cp,
                "best_move": best_san,
                "best_pv": best_pv_str,
                "alternatives": alternatives,
                "fen": fen_before,
            })

            prev_cp = after_cp
            prev_info = infos[0]
            prev_infos = infos

    return records, game


@mcp.tool()
def analyze_game(
    pgn: str,
    depth: int = DEFAULT_DEPTH,
    min_cp_loss: int = 50,
    verbose: bool = False,
) -> list[dict] | dict:
    """
    List the mistakes in a PGN game: moves where cp_loss >= min_cp_loss
    (default 50, i.e. inaccuracies and worse). Set min_cp_loss=0 for all moves.

    Each entry (lean default): move_number, color, move, cp_loss, classification,
    best_move. cp_loss is how much worse than best play (white-POV centipawns).
    Pass verbose=True to also include eval_after (position eval, white-POV) and
    best_pv (refutation line, SAN).

    Call get_game_summary first for an overview. To drill into one mistake
    (FEN, alternatives, full line) call get_position with its move_number+color.
    On bad input returns {"error","reason"}.
    """
    try:
        records, _ = _analyse_all_moves(pgn, depth, DEFAULT_MULTIPV)
    except ValueError as e:
        return {"error": "invalid_pgn", "reason": str(e)}

    out = []
    for r in records:
        if r["cp_loss"] < min_cp_loss:
            continue
        entry = {
            "move_number": r["move_number"],
            "color": r["color"],
            "move": r["move"],
            "cp_loss": r["cp_loss"],
            "classification": r["classification"],
            "best_move": r["best_move"],
        }
        if verbose:
            entry["eval_after"] = r["eval_after"]
            entry["best_pv"] = r["best_pv"]
        out.append(entry)
    return out


@mcp.tool()
def get_game_summary(pgn: str, depth: int = DEFAULT_DEPTH) -> dict:
    """
    Overview of a PGN game without per-move detail. Call this first.

    Returns: opening (from PGN headers, else null), total_moves (count of moves
    at/above inaccuracy), per-side white/black {blunders, mistakes, inaccuracies,
    good_moves, accuracy_pct}, and worst_moves (top 3 by cp_loss, each with
    move_number, color, move, cp_loss, classification, best_move).

    Drill into any worst_move via get_position(pgn, move_number, color).
    On bad input returns {"error","reason"}.
    """
    try:
        records, game = _analyse_all_moves(pgn, depth, DEFAULT_MULTIPV)
    except ValueError as e:
        return {"error": "invalid_pgn", "reason": str(e)}

    headers = game.headers
    opening = headers.get("Opening") or headers.get("ECO") or None

    stats: dict[str, dict] = {
        "white": {"blunder": 0, "mistake": 0, "inaccuracy": 0, "good": 0, "_acc_sum": 0.0, "_count": 0},
        "black": {"blunder": 0, "mistake": 0, "inaccuracy": 0, "good": 0, "_acc_sum": 0.0, "_count": 0},
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
    worst_3_out = [
        {
            "move_number": r["move_number"],
            "color": r["color"],
            "move": r["move"],
            "cp_loss": r["cp_loss"],
            "classification": r["classification"],
            "best_move": r["best_move"],
        }
        for r in worst_3
    ]

    return {
        "opening": opening,
        "total_moves": len(records),
        "white": _side_summary(stats["white"]),
        "black": _side_summary(stats["black"]),
        "worst_moves": worst_3_out,
    }


@mcp.tool()
def get_position(
    pgn: str,
    move_number: int,
    color: str,
    depth: int = DEFAULT_DEPTH,
) -> dict:
    """
    Detail for one move in a game — the drill-down companion to get_game_summary
    and analyze_game. Identify the move by move_number + color ("white"/"black"),
    as reported by those tools.

    Returns: fen (the position with `color` to move, ready to pass to
    evaluate_position/validate_line/get_legal_moves), eval_cp (position eval,
    white-POV centipawns), move_played (SAN actually played), best_move (SAN),
    best_pv (best line, SAN), alternatives (top engine replies, each {move, eval}).

    On bad input or no such move returns {"error","reason"}.
    """
    if color not in ("white", "black"):
        return {"error": "invalid_color", "reason": "color must be 'white' or 'black'"}
    try:
        records, _ = _analyse_all_moves(pgn, depth, DEFAULT_MULTIPV)
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
    return {"error": "move_not_found", "reason": f"no {color} move {move_number} in game"}


@mcp.tool()
def evaluate_position(fen: str, depth: int = DEFAULT_DEPTH) -> dict:
    """
    Evaluate a single position by FEN with Stockfish.

    Returns: score_cp (white-POV centipawns; ±10000 = mate), score_type
    ("cp"|"mate"), mate_in (signed mate distance, else null), best_move (SAN),
    pv (best line, SAN), depth (search depth reached).
    On invalid FEN returns {"error","reason"}.
    """
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"error": "invalid_fen", "reason": str(e)}

    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        info = engine.analyse(board, chess.engine.Limit(depth=depth))

    pv = info.get("pv", [])
    best_move = board.san(pv[0]) if pv else None
    cp, score_type, mate_in = _score_details(info["score"])

    return {
        "score_cp": cp,
        "score_type": score_type,
        "mate_in": mate_in,
        "best_move": best_move,
        "pv": _pv_san(board, pv),
        "depth": info.get("depth", depth),
    }


@mcp.tool()
def validate_line(fen: str, moves: list[str]) -> dict:
    """
    Check whether a sequence of moves (UCI or SAN) is legal from a position.
    Use this to ground any line before stating it.

    Success: {valid: true, moves_validated, final_fen}.
    Failure: {valid: false, error_at_index, error_move, reason, fen_at_error}
    (fen_at_error = the position where the bad move was attempted).
    On invalid FEN returns {"error","reason"}.
    """
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
    List every legal move from a position. Use to pick a grounded move instead
    of guessing one.

    Returns: turn ("white"|"black"), move_count, moves. By default moves is a
    space-separated SAN string ("Nf3 Nc3 e4 ..."). Pass uci=True to instead get
    a list of {uci, san} (use when you need UCI strings).
    On invalid FEN returns {"error","reason"}.
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


if __name__ == "__main__":
    mcp.run(transport="sse")
