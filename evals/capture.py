"""Capture real tool outputs on sample-game.pgn → evals/snapshots/outputs.json.

Run when a tool's output shape changes. Needs Stockfish (STOCKFISH_PATH).
Output is committed; measure.py reads it offline, no engine.

In Docker (the supported way to get Stockfish):
    docker run --rm -v "$PWD":/work -w /app \
        -e STOCKFISH_PATH=/usr/games/stockfish \
        chess-mcp-chess-mcp:latest uv run python /work/evals/capture.py
"""
import json, datetime, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "server"))
import chess_mcp as cm

ROOT = pathlib.Path(__file__).parent.parent
PGN = (ROOT / "sample-game.pgn").read_text()
DEPTH = 18


def main():
    summary = cm.get_game_summary(PGN, DEPTH)
    wm = summary["worst_moves"][0]                       # real move to drill
    pos = cm.get_position(PGN, wm["move_number"], wm["color"], DEPTH)
    fen = pos["fen"]
    outputs = {
        "get_game_summary":     summary,
        "analyze_game.lean":    cm.analyze_game(PGN, DEPTH, 50, False),
        "analyze_game.verbose": cm.analyze_game(PGN, DEPTH, 50, True),
        "get_position":         pos,
        "evaluate_position":    cm.evaluate_position(fen, DEPTH),
        "evaluate_position.mpv": cm.evaluate_position(fen, DEPTH, 3),
        "get_legal_moves.san":  cm.get_legal_moves(fen, False),
        "get_legal_moves.uci":  cm.get_legal_moves(fen, True),
    }
    tools = [cm.get_game_summary, cm.analyze_game, cm.get_position,
             cm.evaluate_position, cm.validate_line, cm.get_legal_moves]
    snap = {
        "metadata": {"pgn_file": "sample-game.pgn", "depth": DEPTH,
                     "captured_at": datetime.datetime.now(datetime.UTC).isoformat()},
        "outputs": {k: json.dumps(v, separators=(",", ":")) for k, v in outputs.items()},
        "descriptions": {t.__name__: (t.__doc__ or "") for t in tools},
    }
    out = ROOT / "evals" / "snapshots" / "outputs.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
