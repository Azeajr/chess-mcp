#!/usr/bin/env python3
from mcp.server.fastmcp import FastMCP
import chess
import chess.pgn
import chess.engine
import io
import os

ENGINE_PATH = os.environ.get("STOCKFISH_PATH", "/usr/bin/stockfish")
DEFAULT_DEPTH = int(os.environ.get("ANALYSIS_DEPTH", "18"))

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


def _analyse_all_moves(
    pgn: str, depth: int, multipv: int
) -> tuple[list[dict], chess.pgn.Game]:
    """Run engine analysis on every move. Returns (move_records, game)."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ValueError("Invalid PGN")

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
                "eval_after": after_cp,
                "best_move": best_san,
                "best_pv": best_pv_str,
                "alternatives": alternatives,
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
    multipv: int = 3,
) -> list[dict]:
    """
    Analyze moves in a PGN game. Returns moves where cp_loss >= min_cp_loss
    (default 50, i.e. inaccuracies and worse). Each entry: move_number, color,
    move, cp_loss, classification, eval_after, best_move, best_pv, alternatives.
    Call get_game_summary first for an overview; use this to drill into specific moves.
    Set min_cp_loss=0 to return all moves.
    """
    records, _ = _analyse_all_moves(pgn, depth, multipv)
    return [r for r in records if r["cp_loss"] >= min_cp_loss]


@mcp.tool()
def get_game_summary(pgn: str, depth: int = DEFAULT_DEPTH) -> dict:
    """
    Summarize a PGN game without returning per-move detail.
    Returns blunder/mistake/inaccuracy/good counts, accuracy % per side,
    worst 3 moves by cp_loss, and opening name from PGN headers.
    Call this first; use analyze_game to drill into specific moves.
    """
    records, game = _analyse_all_moves(pgn, depth, multipv=1)

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
def evaluate_position(fen: str, depth: int = DEFAULT_DEPTH) -> dict:
    """
    Evaluate a position by FEN.
    Returns centipawn score (white POV), best move, and top line.
    """
    try:
        board = chess.Board(fen)
    except ValueError as e:
        raise ValueError(f"Invalid FEN: {e}")

    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        info = engine.analyse(board, chess.engine.Limit(depth=depth))

    pv = info.get("pv", [])
    best_move = board.san(pv[0]) if pv else None
    cp, score_type, mate_in = _score_details(info["score"])

    return {
        "fen": fen,
        "score_cp": cp,
        "score_type": score_type,
        "mate_in": mate_in,
        "best_move": best_move,
        "best_move_uci": pv[0].uci() if pv else None,
        "pv": _pv_san(board, pv),
        "depth": info.get("depth", depth),
    }


@mcp.tool()
def validate_line(fen: str, moves: list[str]) -> dict:
    """
    Validate a sequence of moves (UCI or SAN) from a position.
    Returns valid=True if all legal, or the move that fails.
    """
    try:
        board = chess.Board(fen)
    except ValueError as e:
        raise ValueError(f"Invalid FEN: {e}")

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
def get_legal_moves(fen: str) -> dict:
    """
    List all legal moves from a position in both UCI and SAN.
    """
    try:
        board = chess.Board(fen)
    except ValueError as e:
        raise ValueError(f"Invalid FEN: {e}")

    moves = [
        {"uci": m.uci(), "san": board.san(m)}
        for m in board.legal_moves
    ]

    return {
        "fen": fen,
        "turn": "white" if board.turn == chess.WHITE else "black",
        "move_count": len(moves),
        "moves": moves,
    }


if __name__ == "__main__":
    mcp.run(transport="sse")
