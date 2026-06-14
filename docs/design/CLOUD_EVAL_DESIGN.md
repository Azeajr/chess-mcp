# Cloud Eval + Eval Cache Design

Goal: stop re-running Stockfish on positions we (or Lichess) have already evaluated. Issue #28.
Two requirements drive this pass:

- **R1 — persistent local eval cache.** Engine results survive across calls *and* across server
  restarts, keyed per position, so a warm cache cuts wall-clock on batch operations
  (`find_repertoire_gaps`, and #32 `batch_review` later) by ≥50%.
- **R2 — Lichess cloud-eval tier.** A `cloud_eval` tool that returns Lichess's pre-computed
  evaluation for popular positions, plus a reusable rate-limited HTTP client that #25 and #30
  build on.

This is a performance pass with a hard constraint: **it must not weaken the reproducibility or
grounding guarantees** the engine tools already make (`GROUNDING_DESIGN.md`). A cached eval must
be *the same answer Stockfish would give*, or it is a correctness bug, not a speedup.

---

## Current posture (what already holds)

- **Every engine call spawns a fresh process.** All seven analysis sites open
  `chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)` per call
  (`server/chess_mcp.py:330, 602, 779, 1066, 1206, 1551, 1653`). No process reuse, no result reuse.
- **One in-process cache exists, coarse-grained.** `_analyse_tree` carries
  `@lru_cache(maxsize=32)` keyed by `(pgn, depth, multipv, time_limit)`
  (`server/chess_mcp.py:311-332`). It helps a *repeated identical PGN* in one process; it cannot
  help a different PGN that shares opening nodes, and it dies with the process.
- **A position-normalization function already exists** — `repertoire._position_key(board)` =
  first four FEN fields (placement, turn, castling, en passant), clocks dropped
  (`server/repertoire.py:112-115`). It defines *transposition* identity.
- **Inputs are legality-gated before popen** via `_safe_board` (`server/chess_mcp.py:555-569`).
- **Search is depth-XOR-time.** `_limit` returns `Limit(depth=…)` (reproducible, the default) or
  `Limit(time=…)` (wall-clock, *not* bit-reproducible) (`server/chess_mcp.py:77-85`).
- **No runtime makes outbound HTTP.** Only the host-side proxy `chess_files.py` uses `httpx`
  (as an SSE client). `httpx` is already a dependency. The analysis server has never called an
  external API.
- **Server runs in Docker** (`compose.yml`, `project_stockfish_docker_only`).

## Gaps this pass closes

| # | Gap | Req |
|---|-----|-----|
| G1 | Identical opening positions are re-searched on every call and across restarts — the dominant cost in repertoire/batch work. | R1 |
| G2 | No cross-PGN reuse: `_analyse_tree`'s lru_cache is whole-PGN, so two games sharing 12 opening plies pay twice. | R1 |
| G3 | No way to consult Lichess's free pre-computed evals for popular positions. | R2 |
| G4 | No shared, rate-limited HTTP client — #25/#30 would each hand-roll one. | R2 |

---

## Decisions

### D1 — Eval cache key is eval-correct, **not** `_position_key`

The cache key is **the first five FEN fields** — placement, turn, castling, en passant, **and the
halfmove clock** — dropping only the cosmetic fullmove number:

```python
def _eval_key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:5])   # drop fullmove number only
```

**Do not reuse `_position_key`.** That function drops *both* clocks because it answers a different
question (does move-order A reach the same position as move-order B?). An eval cache answers a
stricter one (will Stockfish return the same score?), and the halfmove clock is eval-relevant near
the fifty-move rule. Dropping it would serve a drawn-by-50-move eval for a fresh position with the
same placement. The fullmove number never affects eval, so it is dropped to keep deep-transposition
hit-rate. *(Minor: python-chess prints an en-passant square whenever a pawn just double-stepped,
even when no legal capture exists, occasionally splitting otherwise-identical keys. Costs a hit,
never correctness — accepted.)*

*Rejected:* keying on `_position_key` (loses fifty-move correctness); keying on the full FEN
(fullmove number fragments every transposition for zero eval benefit).

### D2 — Key also pins engine identity and is depth-subsuming

A cached score is only "what Stockfish would say" *for a given engine build and settings*. An NNUE
update or a `Hash`/`Threads` change moves evals at a fixed depth. So the cache row carries an
**engine signature** and the **depth actually reached**:

```
TABLE eval_cache (
    pos_key   TEXT,     -- D1
    engine_id TEXT,     -- "Stockfish 16.1" + relevant UCI options, from engine.id
    multipv   INTEGER,  -- lines stored
    depth     INTEGER,  -- depth REACHED (not requested)
    payload   TEXT,     -- JSON: [{score_cp_white, score_type, mate_in, pv_uci:[...]}, ...]
    created   REAL,
    PRIMARY KEY (pos_key, engine_id, multipv, depth)
)
```

Lookup is **subsuming**: a request for `(key, depth=d, multipv=m)` is served by any row with the
same `engine_id`, `depth >= d`, `multipv >= m` (`ORDER BY depth DESC LIMIT 1`). A deeper, wider
search already contains a shallower, narrower answer — we slice `payload[:m]`. Store under *reached*
depth so a budget-truncated search (the gap scan, D6) is cached honestly: it satisfies only
requests at or below the depth it genuinely reached.

*Rejected:* the issue's `(fen_normalized, depth, eval_json)` key. It omits `multipv` (a cached
multipv=1 row can't answer multipv=5) and omits engine identity (a Stockfish upgrade silently
serves stale evals). Both are correctness holes; D2 closes them.

### D3 — Cache the analyse primitive, transparently, depth-searches only

A single wrapper, `evalcache.cached_analyse`, is the one place results are read/stored. Engine IO
stays the caller's (callers already hold an open engine), so the wrapper takes a thunk:

```python
# evalcache.py
def cached_analyse(board, *, depth, multipv, run) -> list[InfoLike]:
    """run() == engine.analyse(board, Limit(depth=depth), multipv=multipv). Returns a list of
    InfoLike (a dict exposing ["score"] as PovScore and ["pv"] as list[Move]) — drop-in for the
    real InfoDict at every call site. Hit → from SQLite; miss → run(), store, return."""
```

Callers change from `engine.analyse(board, limit, multipv=m)` to
`cached_analyse(board, depth=d, multipv=m, run=lambda: engine.analyse(board, limit, multipv=m))`.

**Only pure depth-limited searches are cached** (`time_limit is None`). Time-limited searches are
wall-clock dependent — non-reproducible by `_limit`'s own contract — so they bypass the cache
entirely (no read, no write). This keeps the cache's "same as Stockfish" invariant true by
construction.

**Serialization is the one subtlety.** `payload` stores, per line, white-POV `score_cp` +
`score_type` + `mate_in` (the `_score_with_type` triple) and `pv` as UCI strings. On a hit we
rebuild an `InfoLike` whose `["score"]` is `PovScore(Cp(cp)|Mate(n), chess.WHITE)` and whose
`["pv"]` is `[Move.from_uci(u), …]`, so existing consumers — `_score_cp`, `_pov_cp`, `board.san`,
`_pv_san`, the `_analyze_tree_nodes` record builder (`server/chess_mcp.py:255-308`) — work
unchanged. A reconstructed white-relative `PovScore` is correct because every consumer reads it
through `.white()` and negates for Black itself (`_pov_cp`, `server/chess_mcp.py:134-139`).

*Rejected:* caching at each tool's public-dict layer. Less code reuse, and it would not help the
internal multi-position loops (`_analyze_tree_nodes`, the gap scan) that do the bulk of the work.

### D4 — Composition with the existing lru_cache

Keep `@lru_cache` on `_analyse_tree` (D-nothing). The layers are orthogonal and stack: lru_cache
serves a repeated *identical PGN* from memory (no SQLite hit at all); on an lru miss (new PGN), the
per-node `cached_analyse` calls underneath hit SQLite for every shared opening node (closing G2).
In-proc memo on top, persistent per-position store beneath.

### D5 — `cloud_eval` is a separate, labeled tool — never silently substituted

```python
@mcp.tool()
def cloud_eval(fen: str, multi_pv: int = 1) -> dict | None:
    """Lichess pre-computed evaluation, or null if the position isn't in their database."""
    # GET https://lichess.org/api/cloud-eval?fen={fen}&multiPv={multi_pv}
```

It returns the Lichess payload tagged `"source": "lichess-cloud"` with the Lichess `depth`. It is
**not** poured into the local Stockfish cache and **not** auto-substituted into `evaluate_position`,
because Lichess's depth ≠ our requested depth and is not under our engine signature — folding it in
would break D2's reproducibility contract. Tier composition (consult cloud before spawning
Stockfish in the gap scan) is a flagged enhancement (Out of scope), gated behind a clear
"approximate / external-source" label, never on the default reproducible path.

*Rejected:* a single `evaluate_position` that transparently prefers cloud. Convenient, but it makes
the eval's provenance and depth non-deterministic — the opposite of the grounding posture.

### D6 — `find_repertoire_gaps` gets lookup + honest store

The gap scan (`server/chess_mcp.py:1551-1565`) searches with `Limit(depth=depth, time=remaining)`
— a depth target with a budget safety cap. Wire it to the cache as: **look up** by `(key, depth,
multipv=5)` and skip Stockfish on a hit (satisfies the AC "skips Stockfish for any FEN in cache");
on a miss, run, then **store only if the reached depth ≥ requested depth** (a budget-truncated
position reached shallower depth → store under that lower reached depth via D2, so it never
masquerades as a full-depth result). The wall-clock budget logic is unchanged; the cache just
removes work from inside it.

### D7 — Shared rate-limited HTTP client (`apiclient.py`)

One module wraps `httpx` with: a process-global client, a configurable timeout, a single-flight
**1 req/s** limiter (Lichess unauthenticated limit), and uniform error mapping to
`{"error": "network", "reason": …}` / `None`. `cloud_eval` is its first consumer; #25
(lichess/chesscom) and #30 (tablebase) reuse it verbatim. **Offline-safe:** any connection error
or timeout degrades to "miss" (`cloud_eval → None`), so the container running without egress
behaves exactly like a cache miss — Stockfish + local cache still serve every request. This honors
`project_stockfish_docker_only`: the engine path never depends on the network.

### D8 — Config, storage location, concurrency

- `EVAL_CACHE_PATH` env var; default `~/.chess-mcp/eval-cache.db`. In Docker `~` is ephemeral, so
  `compose.yml` mounts a named volume at the cache dir and sets `EVAL_CACHE_PATH` to it — the cache
  persists across container restarts (R1). Path is runtime config, never committed
  (`feedback_no_abs_paths_committed`).
- SQLite opened **WAL mode**, `busy_timeout` set, one connection guarded for the (possibly
  threaded) FastMCP server. Writes are small and idempotent (`INSERT OR REPLACE`).
- `CLOUD_EVAL_DISABLED` / `EVAL_CACHE_DISABLED` env flags force-bypass either tier (tests, air-gap).
- **Hit-rate logged at INFO** (AC): periodic `cache hit N/M (xx%)` line from `evalcache`.

---

## New / changed surface

| Item | Kind | Notes |
|------|------|-------|
| `server/evalcache.py` | new module | SQLite store, `_eval_key`, `cached_analyse`, (de)serialization, hit-rate log |
| `server/apiclient.py` | new module | rate-limited httpx GET, offline-safe; reused by #25/#30 |
| `cloud_eval` | new `@mcp.tool` | Lichess passthrough, labeled source (tool count 18→19) |
| `evaluate_position`, `_analyse_tree`, `compare_moves`, suggest_* | edits | route pure-depth analyse through `cached_analyse` |
| `find_repertoire_gaps` | edit | D6 lookup + honest store |
| `compose.yml` | edit | named volume + `EVAL_CACHE_PATH` |
| `server/pyproject.toml` | edit | (httpx already present; confirm) |

---

## Out of scope / follow-ups

- **Cloud-as-prefilter in the gap scan / `batch_review`** — consult `cloud_eval` before spawning
  Stockfish, behind an explicit "approximate, external" flag. Deferred; #32 will revisit, since its
  ≤60s/100-game target leans hardest on it.
- **Cache eviction / TTL.** v1 grows unbounded (evals are tiny; a 300-line repertoire is well under
  a MB). Add size-based pruning only if it becomes real.
- **`evals` snapshot + MCP_DESIGN token table** regen for the new tool (needs Stockfish → Docker,
  `project_stockfish_docker_only`). Tool count 18→19.
- **Version bump + README tool list** at release.

## Test plan

- **`_eval_key`** (engine-free): same placement, different fullmove number → same key; different
  halfmove clock → different key; transposed move orders reaching one position → same key.
- **`cached_analyse` round-trip** (engine-free, fake `run`): miss runs the thunk and stores; second
  call hits without calling the thunk; `(depth=20)` row serves a `(depth=12)` request; `multipv=5`
  row serves `multipv=1` (sliced); a different `engine_id` does **not** hit; `time_limit` set →
  neither read nor write. PovScore/Move reconstruction: a cached row feeds `_score_with_type`,
  `board.san`, `_pv_san` identically to a live InfoDict (cp, mate, sign for a Black-to-move
  position, and a White-delivered-mate position per `_score_with_type`'s sign rule).
- **`cloud_eval`** (mocked httpx): known FEN → Lichess-shaped dict tagged source; unknown → `None`;
  connection error/timeout → `None` (offline-safe); rate limiter spaces calls ≥1s.
- **`find_repertoire_gaps`** (Docker, Stockfish): warm-cache run skips Stockfish on cached nodes,
  same gaps as cold run; benchmark ≥50% wall-clock reduction on a 100-position repertoire warm vs
  cold (AC).
- Engine-free tests land in `server/test_tools.py` (`make test`); the Stockfish benchmark runs in
  Docker.
