"""Build server/openings.tsv (the ECO opening lookup table) from lichess-org/chess-openings.

Source: https://github.com/lichess-org/chess-openings (CC0). Each source row is
eco<TAB>name<TAB>pgn; we replay the PGN and key the opening by the position's EPD
(placement + turn + castling + en passant, via python-chess board.epd()) so the server
can look an opening up by position. Re-run to refresh:

    uv run --with chess python evals/build_openings.py
"""

import io
import pathlib
import urllib.request

import chess
import chess.pgn

BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master"
FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"]
OUT = pathlib.Path(__file__).parent.parent / "server" / "openings.tsv"


def main() -> None:
    rows = []
    for fname in FILES:
        text = (
            urllib.request.urlopen(f"{BASE}/{fname}", timeout=60).read().decode("utf-8")
        )
        for line in text.splitlines()[1:]:  # skip header
            if not line.strip():
                continue
            eco, name, pgn = line.split("\t")[:3]
            game = chess.pgn.read_game(io.StringIO(pgn))
            if game is None:
                continue
            board = game.end().board()
            rows.append((board.epd(), eco, name))

    # dedupe on EPD (first occurrence wins — sources are already ordered by depth)
    seen: set[str] = set()
    out_lines = ["epd\teco\tname"]
    for epd, eco, name in rows:
        if epd in seen:
            continue
        seen.add(epd)
        out_lines.append(f"{epd}\t{eco}\t{name}")

    OUT.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(out_lines) - 1} openings)")


if __name__ == "__main__":
    main()
