# Open work — pick up next session

Context: in one session (2026-06-14) the 7 features #28, #23, #25, #26, #30, #24, #32 plus #27
packaging were built and merged to `main`. Several features were produced by parallel subagents and
integrated via cherry-pick; agents shipped bugs that were caught on integration (broken
`@mcp.resource`, illegal test FENs, malformed PGN fixtures, a Dockerfile missing `boardwidget.py`).
Host tests are engine-free, so most engine/network behavior was only smoke-checked. **Treat all of
this session's code as needing a real correctness pass before trusting it in production.**

## 1. Validate this session's work for bugs + correctness (do first)

Run in Docker (Stockfish + network present); host can't exercise the engine.

- **Per-tool functional + edge cases** (not just import/smoke):
  - `evaluate_position` — cache hit returns identical result to cold; depth subsumption + multipv
    slicing are correct on real searches; mate positions reconstruct correctly (PovScore/`_score_with_type`).
  - `cloud_eval` — live Lichess hit/miss; offline → null.
  - `board_image` — decode the SVG, check orientation flip + `last_move` arrow render; bad input.
  - `lichess_games` / `chesscom_games` — real usernames; color/result inference from headers; ECO
    filter; `include_pgn`; **URL-encode the username** (check for injection) and confirm rate limiting.
  - `repertoire_vs_history` — coverage %/avg-in-book-plies math against a known set of real games;
    transposition handling; wrong-color games dropped.
  - `tablebase_lookup` — more positions (KRK, KBBK, draws); 8-piece gate; **re-examine the WDL
    mapping** — is `blessed-loss → wdl 0` correct? (it's a loss holdable to a draw by the 50-move
    rule; mapping to draw may misreport the outcome). `cursed-win → 2` likewise.
  - `engine_move` — with lc0 + Maia weights actually installed (uncomment the Dockerfile layer):
    does `maia-1500` return a plausible human move? stockfish parity; time clamping.
  - `batch_review` — real multi-game Lichess/Chess.com export; `group_by=structure` and `=color`;
    win/draw/loss + avg_cpl correct vs a hand-checked fixture; `max_games` cap; the `_aggregate_games`
    pure function math.
  - MCP App board (`#26`) — load in a real MCP client (Claude Desktop); board renders/drags;
    "Analyze position" button calls `evaluate_position`.
- **Eval cache correctness** — persistence across container restart (the compose volume);
  engine-id invalidation on a Stockfish version change; that a budget-truncated gap-scan search is
  stored under its reached depth (not requested).
- **Review the agent-authored code** that was integrated but not deeply audited: `batch_review`
  aggregator, tablebase mapping, `engine_move` backend dispatch, `repertoire_vs_history` walk,
  `boardwidget` HTML/JS.
- **Security** — network tools build URLs from user input (encode it); confirm `files.py` path
  confinement still holds after the rename; no secrets/PII in logs.
- **Regression** — run `evals/capture.py` in Docker and diff the snapshot; confirm the 7 features
  didn't change existing tool outputs.

## 2. PyPI release (maintainer-owned, outward-facing)

- Configure the PyPI project's **trusted publisher**: repo `Azeajr/chess-mcp`, workflow `ci.yml`,
  environment `pypi`; create the `pypi` GitHub environment.
- Push tag `v0.3.0` → the `pypi` CI job builds + publishes (OIDC, no token).
- Confirm `uvx chess-mcp` / `pip install chess-mcp` work from the live release.

## 3. Registry listings (maintainer-owned)

- Verify `smithery.yaml` against the current Smithery spec; submit the Smithery registry PR.
- Submit to Glama (`https://glama.ai/mcp/servers/submit`) once the release is live.
- Add Smithery/PyPI badges to the README after listings are live.

## 4. Polish / housekeeping

- Regenerate `evals/snapshots/outputs.json` + the `MCP_DESIGN.md` token table — tool count moved
  19 → 30, the committed snapshot is stale (Docker; `evals/capture.py`, which only covers the
  original tool set — consider extending it to the new tools).
- `#28` ≥50% warm-cache benchmark on a 100-position repertoire (the AC; Docker).
- Add a PyPI long-description: `pyproject.readme` was dropped because the Docker build context is
  `server/` and `../README.md` escapes it — either move packaging to repo root or copy the README in.
- Cache-wiring remaining engine sites: **decided SKIP.** `compare_moves` is unsafe to cache (uses
  `root_moves` → result is candidate-dependent, not position-only); `suggest_*` / `classify` are
  low-traffic one-shots. Documented here so it isn't re-attempted blindly.
