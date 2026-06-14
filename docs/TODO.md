# Open work — pick up next session

Context: in one session (2026-06-14) the 7 features #28, #23, #25, #26, #30, #24, #32 plus #27
packaging were built and merged to `main`. Several features were produced by parallel subagents and
integrated via cherry-pick; agents shipped bugs that were caught on integration (broken
`@mcp.resource`, illegal test FENs, malformed PGN fixtures, a Dockerfile missing `boardwidget.py`).
Host tests are engine-free, so most engine/network behavior was only smoke-checked. **Treat all of
this session's code as needing a real correctness pass before trusting it in production.**

## 1. Validate this session's work for bugs + correctness (do first)

Run in Docker (Stockfish + network present); host can't exercise the engine.

### Already fixed this session (406 tests green + ruff clean; engine/network paths live-verified in Docker, 30/30)

- **`tablebase_lookup` WDL mapping — FIXED.** Old map was internally inconsistent (`cursed-win → 2`
  ignored the 50-move rule while `blessed-loss → 0` respected it) and dumped `maybe-win`/`syzygy-win`/
  `maybe-loss`/`syzygy-loss` into `else → 0`, reporting wins and losses as draws. Now a 5-valued
  Syzygy map (`_WDL_BY_CATEGORY`): win/maybe-win/syzygy-win→2, cursed-win→1, draw→0, blessed-loss→-1,
  loss/maybe-loss/syzygy-loss→-2, unknown→null. Docstring updated; the 3 tests that *enshrined* the
  bug were rewritten + tests added for maybe-loss/syzygy/unknown. **Docker-remaining:** confirm the
  live Lichess `category` strings match this enum exactly; spot-check real cursed-win/blessed-loss
  positions return 1/-1.
- **`batch_review` avg_cpl — FIXED.** Old code drew `avg_cpl` from `get_game_summary`'s `worst_moves`
  = only the top-3 moves, both colors → not an ACPL and not user-relative. Now one `analyze_game`
  (min_cp_loss=0) pass per game → mean cp_loss over the user's own moves (both sides when no
  username); `top_blunders` likewise user-scoped. With a username, only the user's games are kept
  (every group_by mode), per the docstring.
- **`batch_review` win-rate without username — FIXED.** Without a username, decisive games mapped to
  `result=None` → uncounted, so win/loss rates were a misleading 0 that didn't sum to 1. Now
  `_aggregate_games(records, decided=username is not None)` omits win/draw/loss rates + worst/best
  group when there is no user POV (leaves games + avg_cpl + top_blunders).
- **`lichess_games`/`chesscom_games` URL injection — FIXED (security).** The username was
  interpolated into the URL path unencoded (`...format(user=username)`), so `../../../account`
  retargeted the request to a different Lichess endpoint and `evil?max=...` injected query params
  (confirmed via httpx parsing). Now `quote(username, safe="")` on both builders; host test
  `test_games_username_url_encoded` asserts it. FEN-bearing calls already used httpx `params=` (safe).
- **`engine_move` Maia at nodes=1 — FIXED (behavioral).** Every backend ran with a *time limit*, so
  lc0 did multi-node PUCT over the Maia net and drifted toward engine-best (above the target rating).
  maia-* now uses `chess.engine.Limit(nodes=1)` (raw policy = the human-like move; `time_limit_ms`
  ignored); stockfish/leela still search by time. Test `test_engine_move_limit_per_backend`.
  **Docker-remaining:** build the lc0 + Maia-weights image (uncomment the Dockerfile layer; verify the
  `Maia_<r>.pb.gz` → `maia-<r>.pb.gz` download naming actually works) and confirm a real maia-1500
  move is plausibly human + stockfish parity.
- **`repertoire_vs_history` drill-list transposition split — FIXED.** player_deviations and
  uncovered_opponent_moves were aggregated by full FEN, whose move-clocks differ between move orders
  that transpose to the same position — so one recurring deviation/gap split into several count-1
  entries (undercounting the drill list the tool exists to surface, despite the "transposition-aware"
  claim). Now keyed by `repertoire._position_key_from_fen` (clock-free), matching the in-book walk.
  Test `test_repertoire_vs_history_collapses_transpositions`. Coverage/avg math + wrong-color drop
  verified correct against a hand-computed fixture — no other bug.

### Live-verified in Docker this session (real Stockfish + live Lichess, 30/30 checks)

- `evaluate_position`: mate reconstruction (score_type / mate_in / ±10000 / best_move); **eval cache**
  cold==warm + hit registered; **multipv=3** → 3 candidates; **depth+multipv subsumption** serves a
  narrower/shallower request from a stored row (top-N matches), and a deeper-than-stored request
  misses + re-searches; tablebase auto-attach for ≤7 pieces.
- `tablebase_lookup` (live): KQK→2, KvK→0, lost→-2, 8-piece gate; **category-enum coverage** — every
  category the live API returned across a spread of endgames is in `_WDL_BY_CATEGORY` (the real risk:
  an unmapped category → null). **All five WDL categories now confirmed live** (win/draw/loss earlier,
  plus cursed-win→1 and blessed-loss→-1 from Troitsky KNN-v-KP positions, e.g. cursed-win @
  `8/8/8/8/p7/N7/8/K1N1k3` and blessed-loss @ `8/8/8/8/p7/N7/N7/K3k3`), each mapping correctly — fix
  #1 fully verified live.
- `cloud_eval` (live): real hit returns the payload tagged `lichess-cloud`; `CLOUD_EVAL_DISABLED` → null.
- `batch_review` (live, DrNykterstein 3 games): **avg_cpl sane** (sub-200, not the old top-3 inflation);
  with username win/draw/loss present and each group's rates sum to 1, worst/best group present; without
  username the rate fields + worst/best are omitted, avg_cpl kept — fix #2/#3 confirmed on real data.

(Verification harness: `/tmp/chess-verify/verify_live.py`, run in the image with the repo's tool
functions driven directly. Not committed — recreate if needed.)

- **Per-tool functional + edge cases** (not just import/smoke):
  - `evaluate_position` — cache hit returns identical result to cold; depth subsumption + multipv
    slicing are correct on real searches; mate positions reconstruct correctly (PovScore/`_score_with_type`).
  - `cloud_eval` — live Lichess hit/miss; offline → null.
  - `board_image` — VERIFIED (host), no bug: orientation truly flips (white king bottom↔top),
    last_move tints the from/to squares (#cdd16a) + draws an arrow (line+polygon), SAN==UCI render,
    all error paths correct. Render behavior locked by `test_board_image_render_correctness`.
  - `lichess_games` / `chesscom_games` — real usernames; color/result inference from headers; ECO
    filter; `include_pgn`; confirm rate limiting. (URL-injection FIXED + tested — see above; color/
    result + fetch exercised indirectly by batch_review's live run.)
  - `repertoire_vs_history` — VERIFIED (host, hand-computed fixture): coverage=reached/matched, avg
    over matched, wrong-color dropped — all correct. Drill-list transposition-split bug found + FIXED
    (see "Already fixed" above). A live run on a real account is still optional.
  - `tablebase_lookup` — DONE: 5-valued Syzygy mapping fully verified live, all five categories
    incl. cursed-win→1 / blessed-loss→-1 (see "Live-verified" above); 8-piece gate confirmed.
  - `engine_move` — with lc0 + Maia weights actually installed (uncomment the Dockerfile layer):
    does `maia-1500` return a plausible human move? stockfish parity; time clamping.
    **Maia nodes=1 FIXED (host) — see "Already fixed" above;** Docker step is just building the
    lc0 + Maia-weights image and confirming a real maia-1500 move is human + stockfish parity.
  - `batch_review` — real multi-game Lichess/Chess.com export; `group_by=structure` and `=color`;
    win/draw/loss + avg_cpl correct vs a hand-checked fixture; `max_games` cap; the `_aggregate_games`
    pure function math.
  - MCP App board (`#26`) — load in a real MCP client (Claude Desktop); board renders/drags;
    "Analyze position" button calls `evaluate_position`.
- **Eval cache correctness** — persistence across container restart (the compose volume);
  engine-id invalidation on a Stockfish version change; that a budget-truncated gap-scan search is
  stored under its reached depth (not requested). Host audit: subsumption lookup, halfmove-clock
  key, depth-stored-as-reached, and the time-limit bypass are all correct. **Caveat:** the cache
  key `engine_id = engine.id["name"]` (e.g. `"Stockfish 16.1"`) pins the *version* (so a version
  bump invalidates) but NOT the NNUE net or UCI options — the evalcache docstring's "an NNUE/option
  change moves evals [is pinned]" overstates it. Safe under the pinned Docker image; if a net is
  ever swapped without a version bump, stale hits would result. Fold the net hash / key options
  into engine_id if that ever becomes possible.
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

- ~~Regenerate `evals/snapshots/outputs.json` + the `MCP_DESIGN.md` token table~~ **DONE** (Docker):
  descriptions now cover all 30 tools (tools/list ≈ 6411 tok, was ~4570 for 22). capture.py extended
  to list all 30 for the descriptions total; OUTPUTS deliberately stay the engine-deterministic,
  non-network subset — cloud_eval / tablebase_lookup / lichess_games / chesscom_games /
  repertoire_vs_history are non-reproducible (network), engine_move is time-limited, board_image is a
  large base64 blob — so none belong in a diffable snapshot. MCP_DESIGN token table synced (note:
  repertoire-handle outputs embed a random id, so load_repertoire/modify_repertoire_line wobble a few
  tok per capture).
- `#28` ≥50% warm-cache benchmark on a 100-position repertoire (the AC; Docker).
- Add a PyPI long-description: `pyproject.readme` was dropped because the Docker build context is
  `server/` and `../README.md` escapes it — either move packaging to repo root or copy the README in.
- Cache-wiring remaining engine sites: **decided SKIP.** `compare_moves` is unsafe to cache (uses
  `root_moves` → result is candidate-dependent, not position-only); `suggest_*` / `classify` are
  low-traffic one-shots. Documented here so it isn't re-attempted blindly.
