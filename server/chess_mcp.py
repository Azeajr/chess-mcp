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


@mcp.tool()
def analyze_game(pgn: str, depth: int = DEFAULT_DEPTH) -> list[dict]:
    """
    Analyze every move in a PGN game.
    Returns per-move eval, best move, cp loss, and classification.
    """
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ValueError("Invalid PGN")

    results = []
    board = game.board()

    with chess.engine.SimpleEngine.popen_uci(ENGINE_PATH) as engine:
        prev_info = engine.analyse(board, chess.engine.Limit(depth=depth))
        prev_cp = _score_cp(prev_info["score"])

        for node in game.mainline():
            move = node.move
            color = "white" if board.turn == chess.WHITE else "black"
            san = board.san(move)
            uci = move.uci()

            move_number = board.fullmove_number
            best_move = prev_info["pv"][0] if prev_info.get("pv") else move
            best_san = board.san(best_move)

            board.push(move)
            info = engine.analyse(board, chess.engine.Limit(depth=depth))
            after_cp = _score_cp(info["score"])

            cp_loss = (prev_cp - after_cp) if color == "white" else (after_cp - prev_cp)
            cp_loss = max(0, cp_loss)

            results.append({
                "move_number": move_number,
                "color": color,
                "move": san,
                "move_uci": uci,
                "eval_before": prev_cp,
                "eval_after": after_cp,
                "cp_loss": cp_loss,
                "classification": _classify(cp_loss),
                "best_move": best_san,
                "best_move_uci": best_move.uci(),
                "pv": _pv_san(board, info.get("pv", [])),
            })

            prev_cp = after_cp
            prev_info = info

    return results


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

    return {
        "fen": fen,
        "score_cp": _score_cp(info["score"]),
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
