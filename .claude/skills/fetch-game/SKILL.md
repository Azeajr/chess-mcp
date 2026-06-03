---
name: fetch-game
description: >-
  Fetch a chess game PGN from Lichess or Chess.com so it can be reviewed or used as repertoire
  input. Use when the user gives a Lichess game URL/ID, or a Lichess/Chess.com username, and wants
  to pull the game(s) without pasting PGN by hand. Hands the PGN to chess-game-review or
  repertoire-builder.
---

# Fetch game PGN

Removes the manual export/paste step before analysis. Pulls real PGN from the public APIs
(no auth, no engine) and hands it to a review/repertoire skill.

## Use the bundled script

`scripts/fetch.py` (host `python3`, stdlib only — no install):

    python3 .claude/skills/fetch-game/scripts/fetch.py <SOURCE> [--max N] [--out FILE]

`<SOURCE>` is one of:
- a Lichess game URL or 8-char ID  → that game
- `lichess:<username>`             → that user's most recent game(s) (`--max N`, default 1)
- `chesscom:<username>`            → that user's most recent game from their latest monthly archive

Prints PGN to stdout (or writes `--out FILE`). On failure it prints a structured
`{"error": ...}` line and exits non-zero — relay that, don't invent a game.

## After fetching

- One game → pass the PGN straight into **chess-game-review**.
- Repertoire lines / multiple games → hand to **repertoire-builder** (tell it your color).
- Never analyze from a URL alone; fetch the real PGN first. If the fetch fails (private game, bad
  username, rate limit), say so and ask for a pasted PGN instead.

## Notes

- Chess.com single-game URLs aren't exportable by ID on the public API — use `chesscom:<username>`
  and pick the game, or paste the PGN.
- Lichess game export is the most reliable path; prefer a game URL/ID when the user has one.
