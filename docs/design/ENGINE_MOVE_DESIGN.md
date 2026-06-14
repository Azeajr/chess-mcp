# Engine Move Tool Design

Goal: add human-like engine backends (Maia, Leela) alongside Stockfish for repertoire study.
Without human-like engines, gap analysis shows what's theoretically wrong but not what
opponent classes actually punish. The `engine_move` tool returns the best move from a
specified engine backend, enabling empirical repertoire evaluation across player strengths.

---

## Current posture (what already holds)

- **Single engine path.** `evaluate_position` and all analysis tools use Stockfish via
  `chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)`. `ENGINE_PATH` is env-configured
  (`/usr/bin/stockfish` default).
- **Engine-free validation.** `_safe_board(fen)` parses and legality-gates FEN before engine
  work; the pattern is established and reusable.
- **Move rendering.** `_parse_move(board, move_str)` handles UCI/SAN; board owns `san()` and
  legal-move enumeration.
- **Score handling.** `_score_with_type` extracts white-POV cp/mate from engine; `_limit`
  builds `chess.engine.Limit` from depth or time_limit.
- **Docker-only constraint.** All engine binaries live in Docker containers; the host runs
  no engines (`project_stockfish_docker_only`).

---

## Gaps this pass closes

| # | Gap |
|---|-----|
| G1 | No way to query Maia/Leela backends; Stockfish alone shows theory, not human play. |
| G2 | No dispatch mechanism for multiple engines — need to detect which binary/weights are available and choose accordingly. |
| G3 | Maia weights are per-rating (1100, 1200, ..., 1900); need indexed access with graceful "not found" when a specific weight set is missing. |
| G4 | No configuration for lc0 binary or Maia weight directory — users can't point to their setup. |

---

## Decisions

### D1 — Tool signature and backend enumeration

```python
@mcp.tool()
def engine_move(
    fen: str,
    backend: str = "stockfish",
    time_limit_ms: int = 1000
) -> dict:
    """
    Return best move from the specified engine backend.
    
    backend: "stockfish" | "maia-1100" | "maia-1200" | ... | "maia-1900" | "leela"
    time_limit_ms: search time in milliseconds; clamped to [100, 60000].
    
    Returns: {move (SAN), uci, backend, eval_cp (white-POV), eval_type ("cp"|"mate"),
              mate_in (signed, or null), depth}
    
    Invalid FEN → {"error": "invalid_fen", "reason": ...}.
    Unknown backend → {"error": "invalid_backend", "reason": ...}.
    Backend binary/weights missing → {"error": "backend_unavailable", "reason": ...}.
    """
```

**Backend list:** `"stockfish"` is always available (existing path); `"maia-1100"` through
`"maia-1900"` (100-rating increments) require lc0 + corresponding weights; `"leela"` requires
lc0 + full Leela weights. Maia has 9 variants; use a set or tuple for validation.

**Time-limit clamping:** 100ms ≤ time_limit_ms ≤ 60000ms. Matches the `_clamp_time` pattern
applied to depth (e.g., 0.01–60 seconds). Converted to seconds (`time_limit_ms / 1000`) for
`chess.engine.Limit(time=...)`.

*Rejected:* depth-based limiting for lc0/Maia (both are NNUE-based and run on inference
budgets, not depth; time is the natural knob). Depth is Stockfish's native unit and is the
default for `evaluate_position`, but `engine_move` specializes in Maia/Leela, which are
time-native.

### D2 — Engine configuration via environment variables

- **`LC0_PATH`** (optional) — path to lc0 binary. If unset and a Maia/Leela backend is
  requested, return `backend_unavailable` error. Default check: `/usr/bin/lc0` if unset.
- **`MAIA_WEIGHTS_DIR`** (optional) — directory containing Maia weight files. Format:
  `maia-1100.pb.gz`, `maia-1200.pb.gz`, ..., `maia-1900.pb.gz`. If unset, attempt
  `/usr/share/chess/maia-weights` (Docker standard). If a specific weight is missing,
  return `backend_unavailable`.
- **`LEELA_WEIGHTS`** (optional) — path to full Leela network file (single .pb.gz or
  equivalent). If unset, return `backend_unavailable` when `backend="leela"` is requested.

Environment variables are read at tool call time (not module load), so Docker can configure
them in `docker run -e` without rebuilding.

*Rejected:* downloading weights on first use (out of scope; deployment should pre-stage).
Bundling weights in the image (bloats the image; the default Maia install is commented out,
keeping the default image small per the spec).

### D3 — Dispatch and binary availability check

Helper function `_get_engine_path(backend: str) -> tuple[str, str | None]`:
- `backend == "stockfish"` → return `(ENGINE_PATH, None)`.
- `backend.startswith("maia-")` → parse rating (e.g., "maia-1500" → 1500); validate it is in
  [1100, 1900] and a multiple of 100. Look up weight file in `MAIA_WEIGHTS_DIR / f"{backend}.pb.gz"`.
  Return `(LC0_PATH, weight_file)` if found; else `(None, None)` and the caller maps to
  `backend_unavailable`.
- `backend == "leela"` → return `(LC0_PATH, LEELA_WEIGHTS)`.
- Unknown backend → return `(None, None)` and the caller maps to `invalid_backend`.

This separates validation and dispatch concerns from the tool itself.

*Rejected:* trying Stockfish as a fallback if lc0 is missing (violates "graceful degradation"
— the user asked for Maia, not "something close"). The error message must be specific.

### D4 — Engine subprocess management

Reuse the established `chess.engine.SimpleEngine.popen_uci` pattern. For lc0, pass
`options={"WeightsFile": <weight_path>}` to set the network. Example:

```python
with chess.engine.SimpleEngine.popen_uci(lc0_path, options={"WeightsFile": weight_file}) as engine:
    info = engine.analyse(board, limit)
    # ... return best move
```

The `options` dict maps to UCI `setoption` commands before `isready`.

### D5 — Return shape and consistency with evaluate_position

To parallel `evaluate_position` and encourage reuse, `engine_move` returns:

```python
{
    "move": "Nf3",           # SAN
    "uci": "g1f3",           # UCI
    "backend": "maia-1500",  # which engine gave this
    "eval_cp": 30,           # white-POV centipawns; ±10000 = mate
    "eval_type": "cp",       # "cp" | "mate"
    "mate_in": null,         # signed mate distance or null
    "depth": 20              # depth reached (or search time cap equivalent)
}
```

On error:

```python
{
    "error": "backend_unavailable",  # or "invalid_backend", "invalid_fen"
    "reason": "maia-1500 not found; set LC0_PATH and MAIA_WEIGHTS_DIR"
}
```

Reuse `_safe_board`, `_score_with_type`, and `_limit` helpers.

### D6 — Dockerfile: optional, commented-out Maia/lc0 install

Add a new layer to `server/Dockerfile` that installs lc0 and pre-stages Maia weights,
COMMENTED OUT by default. Example:

```dockerfile
# Optional: uncomment to enable Maia/Leela backends (adds ~200MB to image)
# RUN apt-get update && apt-get install -y --no-install-recommends \
#         lc0 \
#     && rm -rf /var/lib/apt/lists/* \
#     && mkdir -p /usr/share/chess/maia-weights
# 
# # Download Maia weights (example: 1500 only; user can extend)
# RUN cd /usr/share/chess/maia-weights && \
#     for rating in 1100 1200 1300 1400 1500 1600 1700 1800 1900; do \
#       wget "https://maiachess.com/maia/Maia_$rating.pb.gz" -O "maia-$rating.pb.gz" || true; \
#     done
```

Docker sets `LC0_PATH=/usr/bin/lc0` and `MAIA_WEIGHTS_DIR=/usr/share/chess/maia-weights` via
`docker run -e` or `docker-compose.yml` environment block.

Host-side tests mock the engine-open call and path check, so no actual lc0 binary is needed
to run the test suite (see Test plan, below).

### D7 — Graceful error messaging

The error `reason` field is instructive, not cryptic. Examples:

- `"maia-1500 not found; set LC0_PATH=/path/to/lc0 and MAIA_WEIGHTS_DIR=/path/to/weights"`
- `"leela backend requested but LEELA_WEIGHTS not set"`
- `"invalid backend: unknown-engine; must be 'stockfish' or 'maia-{1100..1900}' or 'leela'"`

---

## New / changed surface

| Item | Kind | Notes |
|------|------|-------|
| `engine_move` | new `@mcp.tool` | dispatches across Stockfish / Maia / Leela (tool count 19→20) |
| `_get_engine_path` | new helper | backend → (binary_path, weight_path) + validation |
| `_open_engine` | new helper | handles lc0 options (WeightsFile) + error handling |
| `server/Dockerfile` | edit | optional, commented-out lc0 + Maia weights install layer |
| `server/test_tools.py` | edit | backend validation, dispatch, binary-not-found (mocked) |

---

## Out of scope

- **Weight auto-download on first use.** Deployment should pre-stage weights (simplifies ops).
- **Hot-swap engine updates.** Engines are Docker containers; restart the container to change.
- **Benchmarking Maia vs human play.** `engine_move` is the grounding mechanism; repertoire
  tools will consume it to compare vs human move frequencies (a separate project goal).
- **Engine options beyond WeightsFile.** lc0 has many tuning knobs; initial release focuses on
  the weight selection knob. Future: expose via optional `options` dict parameter.

---

## Test plan

All tests are **engine-free** and land in `server/test_tools.py`. Use monkeypatch to mock
engine open and path lookup.

### Backend validation

- `backend="stockfish"` → returns `(ENGINE_PATH, None)` (no weight file needed).
- `backend="maia-1500"` → validates rating is in [1100, 1900], multiple of 100; checks weight
  file exists; returns `(LC0_PATH, weight_path)`.
- `backend="maia-999"` (invalid rating) → error `invalid_backend`.
- `backend="maia-1500"` with unset `MAIA_WEIGHTS_DIR` → error `backend_unavailable`.
- `backend="maia-1500"` with `MAIA_WEIGHTS_DIR` set but weight file missing → error
  `backend_unavailable` with instructive reason.
- `backend="leela"` with unset `LEELA_WEIGHTS` → error `backend_unavailable`.
- `backend="unknown-engine"` → error `invalid_backend`.

### Time-limit clamping

- `time_limit_ms=50` → clamped to 100ms (log a warning or silently clamp; consistent with
  depth clamping).
- `time_limit_ms=70000` → clamped to 60000ms.
- `time_limit_ms=5000` (in range) → used as-is.

### FEN validation

- Valid FEN → dispatch to engine.
- Invalid FEN → error `invalid_fen`.
- Illegal-but-parseable FEN (board.status() != VALID) → error `invalid_fen` (reuse `_safe_board`).

### Engine dispatch (mocked)

- Mock `chess.engine.SimpleEngine.popen_uci` to return a fake engine with a canned `analyse`
  result.
- `engine_move(fen, backend="stockfish")` → mocked engine opens at `ENGINE_PATH`, returns
  move + eval + depth.
- `engine_move(fen, backend="maia-1500")` → mocked engine opens at `LC0_PATH`, with
  `options={"WeightsFile": <weight_path>}` passed to `popen_uci`. Verify that the option is
  set (inspect the call).
- Return shape: {move, uci, backend, eval_cp, eval_type, mate_in, depth}.

### Engine unavailable (mocked)

- Mock engine open to raise `FileNotFoundError` or `subprocess.CalledProcessError`.
- `engine_move(fen, backend="maia-1500")` with mocked open failure → error `backend_unavailable`.

---

## Acceptance criteria (from issue #24)

- ✓ `engine_move(fen, backend="stockfish")` unchanged behavior (reuses existing Stockfish).
- ✓ `engine_move(fen, backend="maia-1500")` returns a legal move from Maia-1500 weights
  (verified in Docker with lc0 installed; out of host scope for unit tests).
- ✓ Engine binary path configurable via env vars (`LC0_PATH`, `MAIA_WEIGHTS_DIR`).
- ✓ Graceful error if backend not installed: `{"error": "backend_unavailable", "reason": "..."}`
- ✓ Docker image updated with optional Maia/lc0 install step (commented out by default).
