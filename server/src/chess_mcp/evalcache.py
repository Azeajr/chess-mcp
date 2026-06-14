"""Persistent per-position Stockfish eval cache (#28, CLOUD_EVAL_DESIGN.md).

Every engine call in chess_mcp.py spawns a fresh Stockfish and re-searches from scratch; a
300-line repertoire or a batch review re-evaluates the same opening positions hundreds of times.
This module is the one place engine results are stored and reused, keyed per position, persisted
in SQLite so the cache survives restarts.

Correctness invariant: a cache hit is *the same answer Stockfish would have returned*. That drives
every design choice here —

* Key (D1) keeps the halfmove clock (eval-relevant near the 50-move rule); drops only the cosmetic
  fullmove number. NOT repertoire._position_key, which drops both clocks for transposition identity.
* Key (D2) pins the engine signature (an NNUE/option change moves evals) and stores the depth
  *reached* (not requested), so a budget-truncated search is cached honestly. Lookup is subsuming:
  a deeper/wider row serves a shallower/narrower request.
* Only depth-targeted searches are cached (D3). A pure time-limited search is wall-clock dependent
  (not reproducible) and bypasses the cache entirely — no read, no write.
"""

import json
import logging
import os
import pathlib
import sqlite3
import threading
import time

import chess
import chess.engine

log = logging.getLogger("chess_mcp.evalcache")

_DEFAULT_PATH = pathlib.Path.home() / ".chess-mcp" / "eval-cache.db"
_LOG_EVERY = 50  # emit a hit-rate line every N lookups (AC: hit rate logged at INFO)

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()
_hits = 0
_misses = 0


def _eval_key(board: chess.Board) -> str:
    """Eval-cache position key: placement, turn, castling, en passant, halfmove clock — every FEN
    field except the fullmove number. The halfmove clock stays because it changes the eval near the
    fifty-move rule; the fullmove number is dropped because it never does (keeps transposition hits).
    """
    return " ".join(board.fen().split()[:5])


def _disabled() -> bool:
    return bool(os.environ.get("EVAL_CACHE_DISABLED"))


def _db_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("EVAL_CACHE_PATH", _DEFAULT_PATH))


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        path = _db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS eval_cache ("
            " pos_key TEXT, engine_id TEXT, multipv INTEGER, depth INTEGER,"
            " payload TEXT, created REAL,"
            " PRIMARY KEY (pos_key, engine_id, multipv, depth))"
        )
        conn.commit()
        _conn = conn
    return _conn


def reset() -> None:
    """Drop the cached connection and zero the counters. For tests that retarget EVAL_CACHE_PATH."""
    global _conn, _hits, _misses
    if _conn is not None:
        _conn.close()
    _conn = None
    _hits = _misses = 0


# --- (de)serialization: store white-POV score + UCI pv; rebuild an InfoDict-compatible row ----
# Consumers read info["score"] only through _score_with_type/_score_cp (which call .white()), so a
# white-relative PovScore round-trips correctly; info["pv"] is rebuilt as a list[chess.Move].


def _ser_line(info: dict) -> dict:
    score = info["score"].white()
    if score.is_mate():
        v, t = score.mate(), "mate"
    else:
        v, t = score.score(), "cp"
    return {
        "t": t,
        "v": v,
        "pv": [m.uci() for m in info.get("pv", [])],
        "d": info.get("depth"),
    }


def _deser_line(d: dict) -> dict:
    raw = chess.engine.Mate(d["v"]) if d["t"] == "mate" else chess.engine.Cp(d["v"])
    return {
        "score": chess.engine.PovScore(raw, chess.WHITE),
        "pv": [chess.Move.from_uci(u) for u in d["pv"]],
        "depth": d["d"],
    }


def _maybe_log() -> None:
    total = _hits + _misses
    if total and total % _LOG_EVERY == 0:
        pct = 100.0 * _hits / total
        log.info("eval cache hit %d/%d (%.0f%%)", _hits, total, pct)


def _lookup(
    pos_key: str, engine_id: str, multipv: int, depth: int
) -> list[dict] | None:
    conn = _get_conn()
    with _lock:
        row = conn.execute(
            "SELECT payload FROM eval_cache WHERE pos_key=? AND engine_id=?"
            " AND multipv>=? AND depth>=? ORDER BY depth DESC LIMIT 1",
            (pos_key, engine_id, multipv, depth),
        ).fetchone()
    if row is None:
        return None
    lines = json.loads(row[0])
    return [_deser_line(d) for d in lines[:multipv]]


def _store(pos_key: str, engine_id: str, multipv: int, infos: list[dict]) -> None:
    if not infos:
        return
    lines = [_ser_line(i) for i in infos]
    # Belt-and-suspenders: a "mate 0" score (mate on the board) has an ambiguous reconstructed
    # sign; such terminal positions are never analysed here, but skip storing if one appears.
    if any(line["t"] == "mate" and line["v"] == 0 for line in lines):
        return
    reached = min((i.get("depth") or 0) for i in infos)
    payload = json.dumps(lines, separators=(",", ":"))
    conn = _get_conn()
    with _lock:
        conn.execute(
            "INSERT OR REPLACE INTO eval_cache VALUES (?,?,?,?,?,?)",
            (pos_key, engine_id, multipv, reached, payload, time.time()),
        )
        conn.commit()


def cached_analyse(
    board: chess.Board,
    limit: chess.engine.Limit,
    multipv: int,
    engine_id: str,
    run,
) -> list[dict]:
    """Cache-front for `run()`, where run() == engine.analyse(board, limit, multipv=multipv).

    Returns a list of InfoDict-compatible rows (exposing ["score"] PovScore, ["pv"] list[Move],
    ["depth"] int) — a drop-in for the real multipv InfoList at every call site. Cacheable iff the
    limit targets a depth (limit.depth is not None); a pure time-limited search bypasses entirely.
    """
    global _hits, _misses
    depth = getattr(limit, "depth", None)
    if _disabled() or depth is None:
        return run()

    pos_key = _eval_key(board)
    hit = _lookup(pos_key, engine_id, multipv, depth)
    if hit is not None:
        _hits += 1
        _maybe_log()
        return hit

    _misses += 1
    _maybe_log()
    infos = run()
    _store(pos_key, engine_id, multipv, infos)
    return infos
