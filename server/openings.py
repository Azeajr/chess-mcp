"""ECO opening lookup. Engine-free.

Data: openings.tsv, vendored from lichess-org/chess-openings (CC0), keyed by EPD
(placement + turn + castling + en passant, via board.epd()). 3700 named openings.
"""

import functools
import pathlib

import chess
import chess.pgn

_TSV = pathlib.Path(__file__).parent / "openings.tsv"


@functools.lru_cache(maxsize=1)
def _table() -> dict[str, tuple[str, str]]:
    table: dict[str, tuple[str, str]] = {}
    for line in _TSV.read_text(encoding="utf-8").splitlines()[1:]:  # skip header
        epd, eco, name = line.split("\t")
        table[epd] = (eco, name)
    return table


def identify(board: chess.Board) -> dict | None:
    """The named opening at exactly this position (by EPD), or None."""
    hit = _table().get(board.epd())
    return {"eco": hit[0], "name": hit[1]} if hit else None


def deepest_in_line(game: chess.pgn.Game) -> dict | None:
    """The DEEPEST named opening the game's mainline passes through (the standard
    'walk forward, last match wins'), or None. Includes the ply where it is reached."""
    table = _table()
    best = None
    board = game.board()
    for move in game.mainline_moves():
        board.push(move)
        hit = table.get(board.epd())
        if hit is not None:
            best = {"eco": hit[0], "name": hit[1], "ply": board.ply()}
    return best
