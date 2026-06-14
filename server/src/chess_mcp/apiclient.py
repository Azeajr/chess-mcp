"""Shared, rate-limited, offline-safe HTTP client for the analysis server's outbound calls.

The analysis server is otherwise self-contained (Stockfish + local data); this is the ONE place
it talks to an external API. `cloud_eval` (#28) is the first consumer; `lichess_games` /
`chesscom_games` (#25) and `tablebase_lookup` (#30) reuse it verbatim.

Contract (CLOUD_EVAL_DESIGN.md D7): every failure — connection refused, timeout, non-200,
unparseable body — degrades to `None`, never an exception. So a container with no network egress
behaves exactly like a cache/database miss, and the Stockfish path never depends on the network
(project_stockfish_docker_only). A single process-global limiter enforces the 1 req/s Lichess
asks of unauthenticated clients.
"""

import logging
import os
import threading
import time

import httpx

log = logging.getLogger("chess_mcp.apiclient")

_TIMEOUT_S = float(os.environ.get("HTTP_TIMEOUT_S", "5"))
# Lichess unauthenticated rate limit is ~1 req/s; one global limiter covers every consumer.
_MIN_INTERVAL_S = float(os.environ.get("HTTP_MIN_INTERVAL_S", "1.0"))
_UA = os.environ.get(
    "HTTP_USER_AGENT", "chess-mcp (https://github.com/azeajr/chess-mcp)"
)

_client: httpx.Client | None = None
_lock = threading.Lock()
_last_request = 0.0


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=_TIMEOUT_S, headers={"User-Agent": _UA})
    return _client


def _throttle() -> None:
    """Block until at least _MIN_INTERVAL_S has passed since the previous request. The lock
    serializes callers, so the limiter holds across the (low-volume) tools that share it."""
    global _last_request
    wait = _MIN_INTERVAL_S - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()


def get_json(
    url: str, params: dict | None = None, headers: dict | None = None
) -> dict | list | None:
    """Rate-limited GET → parsed JSON, or None on ANY failure (offline-safe). Never raises."""
    with _lock:
        _throttle()
        try:
            resp = _get_client().get(url, params=params, headers=headers)
        except httpx.HTTPError as e:
            log.info("http get failed %s: %s", url, e)
            return None
    if resp.status_code != 200:
        log.info("http get %s -> %s", url, resp.status_code)
        return None
    try:
        return resp.json()
    except ValueError as e:
        log.info("http get %s -> unparseable body: %s", url, e)
        return None


def get_ndjson(
    url: str, params: dict | None = None, headers: dict | None = None
) -> list[dict] | None:
    """Rate-limited GET of an NDJSON stream (Lichess game export) → list of objects, or None.
    Provided for #25; unused by #28 but kept here so the one HTTP surface stays in one module."""
    import json

    with _lock:
        _throttle()
        try:
            resp = _get_client().get(url, params=params, headers=headers)
        except httpx.HTTPError as e:
            log.info("http get failed %s: %s", url, e)
            return None
    if resp.status_code != 200:
        log.info("http get %s -> %s", url, resp.status_code)
        return None
    out: list[dict] = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            return None
    return out
