#!/usr/bin/env python3
"""Fetch a game PGN from Lichess or Chess.com (public APIs, no auth, stdlib only).

Usage:
    fetch.py <SOURCE> [--max N] [--out FILE]

SOURCE:
    <lichess game URL or 8-char ID>   one game
    lichess:<username>                user's most recent game(s) (--max, default 1)
    chesscom:<username>               user's most recent game (latest monthly archive)

Prints PGN to stdout (or to --out FILE). On failure prints {"error": "..."} and exits nonzero.
"""
import json
import re
import sys
import urllib.error
import urllib.request

UA = "chess-mcp-fetch/1.0 (https://github.com/Azeajr/chess-mcp)"


def _get(url, accept="application/x-chess-pgn"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def _fail(msg, code=2):
    print(json.dumps({"error": msg}))
    sys.exit(code)


def lichess_game(game_id):
    return _get(f"https://lichess.org/game/export/{game_id}?clocks=false&evals=false")


def lichess_user(user, n):
    return _get(f"https://lichess.org/api/games/user/{user}?max={n}")


def chesscom_user(user):
    arch = json.loads(_get(f"https://api.chess.com/pub/player/{user}/games/archives",
                           accept="application/json"))
    urls = arch.get("archives", [])
    if not urls:
        _fail(f"no chess.com archives for user '{user}'")
    games = json.loads(_get(urls[-1], accept="application/json")).get("games", [])
    if not games:
        _fail(f"latest chess.com archive empty for '{user}'")
    pgn = games[-1].get("pgn")
    if not pgn:
        _fail("most recent chess.com game has no PGN")
    return pgn


def resolve(source, n):
    m = re.search(r"lichess\.org/(\w{8})", source)
    if m:
        return lichess_game(m.group(1))
    if re.fullmatch(r"\w{8}", source):
        return lichess_game(source)
    if source.startswith("lichess:"):
        return lichess_user(source.split(":", 1)[1], n)
    if source.startswith("chesscom:"):
        return chesscom_user(source.split(":", 1)[1])
    _fail("unrecognized SOURCE: use a lichess game URL/ID, lichess:<user>, or chesscom:<user>")


def main():
    args = sys.argv[1:]
    if not args:
        _fail("usage: fetch.py <SOURCE> [--max N] [--out FILE]")
    n, out, src = 1, None, None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--max":
            n, i = int(args[i + 1]), i + 2
        elif a == "--out":
            out, i = args[i + 1], i + 2
        else:
            src, i = a, i + 1
    if src is None:
        _fail("no SOURCE given")
    try:
        pgn = resolve(src, n)
    except urllib.error.HTTPError as e:
        _fail(f"http {e.code} fetching game (private, bad username, or rate-limited)")
    except urllib.error.URLError as e:
        _fail(f"network error: {e.reason}")
    if not pgn or not pgn.strip():
        _fail("empty PGN returned")
    if out:
        with open(out, "w") as f:
            f.write(pgn)
        print(out)
    else:
        sys.stdout.write(pgn if pgn.endswith("\n") else pgn + "\n")


if __name__ == "__main__":
    main()
