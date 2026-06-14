"""Capture real tool outputs → evals/snapshots/outputs.json.

Run when a tool's output shape changes. Needs Stockfish (STOCKFISH_PATH).
Output is committed; measure.py reads it offline, no engine.

In Docker (the supported way to get Stockfish):
    docker run --rm -v "$PWD":/work -w /app \
        -e STOCKFISH_PATH=/usr/games/stockfish \
        chess-mcp-chess-mcp:latest uv run python /work/evals/capture.py
"""

import json
import datetime
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "server" / "src"))
from chess_mcp import server as cm

ROOT = pathlib.Path(__file__).parent.parent
PGN = (ROOT / "sample-game.pgn").read_text()
REPERTOIRE_PGN = (ROOT / "sample-repertoire.pgn").read_text()
DEPTH = 18


def main():
    # --- existing game tools ---
    summary = cm.get_game_summary(PGN, DEPTH)
    wm = summary["worst_moves"][0]
    pos = cm.get_position(PGN, wm["move_number"], wm["color"], DEPTH)
    fen = pos["fen"]
    outputs = {
        "get_game_summary": summary,
        "analyze_game.lean": cm.analyze_game(PGN, DEPTH, 50, False),
        "analyze_game.verbose": cm.analyze_game(PGN, DEPTH, 50, True),
        "get_position": pos,
        "evaluate_position": cm.evaluate_position(fen, DEPTH),
        "evaluate_position.mpv": cm.evaluate_position(fen, DEPTH, 3),
        "get_legal_moves.san": cm.get_legal_moves(fen, False),
        "get_legal_moves.uci": cm.get_legal_moves(fen, True),
        "validate_fen": cm.validate_fen(fen),
        "validate_pgn": cm.validate_pgn(PGN),
        "identify_opening": cm.identify_opening(PGN),
        "export_annotated_pgn": cm.export_annotated_pgn(PGN, DEPTH),
    }

    # compare_moves: rank a few legal candidate moves from the worst-move position
    import chess

    cand = [chess.Board(fen).san(m) for m in list(chess.Board(fen).legal_moves)[:3]]
    outputs["compare_moves"] = cm.compare_moves(fen, cand, DEPTH)

    # --- repertoire tools (engine-free paths; suggest uses engine for anchor FEN) ---
    rep = cm.load_repertoire(REPERTOIRE_PGN, "white")
    rid = rep["repertoire_id"]
    outputs["load_repertoire"] = rep
    outputs["get_structural_profile.aggregate"] = cm.get_structural_profile(rid)

    # first leaf path from the repertoire
    import chess.pgn
    import io
    from chess_mcp import repertoire as rp

    game = chess.pgn.read_game(io.StringIO(REPERTOIRE_PGN))
    leaf_path = rp.san_path(next(rp.walk_leaves(game)))
    outputs["get_structural_profile.node"] = cm.get_structural_profile(rid, leaf_path)
    outputs["analyze_repertoire_congruence"] = cm.analyze_repertoire_congruence(rid)
    outputs["get_transpositions"] = cm.get_transpositions(rid)
    outputs["get_repertoire_coverage"] = cm.get_repertoire_coverage(rid)
    outputs["find_repertoire_gaps"] = cm.find_repertoire_gaps(rid, DEPTH)
    outputs["classify_illustrative_lines"] = cm.classify_illustrative_lines(rid, DEPTH)

    # stateful edit loop (engine-free): graft a new first move, then export the modified tree
    edited = cm.modify_repertoire_line(rid, [], "add", add_moves=["e4"])
    outputs["modify_repertoire_line"] = edited
    outputs["export_repertoire"] = cm.export_repertoire(edited["new_repertoire_id"])

    # suggest from the leaf FEN (uses engine)
    node = rp.resolve_path(game, leaf_path)
    leaf_fen = node.board().fen()
    outputs["suggest_complementary_lines.low_mem"] = cm.suggest_complementary_lines(
        rid, leaf_fen, "low_memorization", DEPTH, 3
    )
    outputs["suggest_complementary_lines.sharp"] = cm.suggest_complementary_lines(
        rid, leaf_fen, "sharp", DEPTH, 3
    )

    # suggest from a gap FEN (opponent to move) — exercises auto-advance
    gap_fen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"
    outputs["suggest_complementary_lines.gap_auto_advance"] = (
        cm.suggest_complementary_lines(rid, gap_fen, "low_memorization", DEPTH, 3)
    )

    tools = [
        cm.get_game_summary,
        cm.analyze_game,
        cm.get_position,
        cm.evaluate_position,
        cm.validate_line,
        cm.get_legal_moves,
        cm.validate_fen,
        cm.validate_pgn,
        cm.compare_moves,
        cm.identify_opening,
        cm.export_annotated_pgn,
        cm.load_repertoire,
        cm.get_structural_profile,
        cm.analyze_repertoire_congruence,
        cm.get_transpositions,
        cm.get_repertoire_coverage,
        cm.find_repertoire_gaps,
        cm.classify_illustrative_lines,
        cm.suggest_complementary_lines,
        cm.suggest_replacement_line,
        cm.modify_repertoire_line,
        cm.export_repertoire,
        # #23–#32 tools: listed so the descriptions total reflects the real tools/list cost
        # (all 30 tools' docstrings are loaded on every tools/list). Their live OUTPUTS are
        # deliberately NOT captured below — network results (cloud_eval / tablebase_lookup /
        # lichess_games / chesscom_games / repertoire_vs_history) aren't reproducible,
        # engine_move is time-limited (also non-reproducible), and board_image is a large
        # base64 SVG blob — none belong in a committed, diffable snapshot.
        cm.tablebase_lookup,
        cm.cloud_eval,
        cm.board_image,
        cm.engine_move,
        cm.batch_review,
        cm.lichess_games,
        cm.chesscom_games,
        cm.repertoire_vs_history,
    ]
    snap = {
        "metadata": {
            "pgn_file": "sample-game.pgn",
            "repertoire_pgn_file": "sample-repertoire.pgn",
            "depth": DEPTH,
            "captured_at": datetime.datetime.now(datetime.UTC).isoformat(),
        },
        "outputs": {
            k: json.dumps(v, separators=(",", ":")) for k, v in outputs.items()
        },
        "descriptions": {t.__name__: (t.__doc__ or "") for t in tools},
    }
    out = ROOT / "evals" / "snapshots" / "outputs.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
