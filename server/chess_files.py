#!/usr/bin/env python3
"""chess-files: a host-side MCP proxy that loads/exports a repertoire by FILE PATH.

Why this exists (see PROXY_DESIGN.md): `load_repertoire` already turns a big PGN into a short
handle, but the PGN still enters the model's context ONCE — when the model reads the file to
build the tool argument. That read is where a client-side truncation silently corrupted a whole
run (issue.md), and it is pure input-token cost. This server moves the read off the model:

    model --path--> chess-files (host, stdio) --reads file--> pgn
                          |                                     |
                          |  SSE client                        v
                          +---------------------> chess-analysis (:8000, Docker)
                          |                                     |
    model <-- id only ----+------------------------------------+

The proxy runs over stdio (the MCP client spawns it per session) so it has the user's
filesystem, and is itself an SSE client to the unchanged chess-analysis backend. A returned
repertoire_id resolves in the model's other repertoire calls because the proxy and the main
client hit the SAME backend process (the handle cache is process-global) — see PROXY_DESIGN §3.1.

Engine-free and backend-agnostic: every chess concern stays on :8000; this layer only does file
I/O, base-dir confinement, and relaying.
"""

import json
import os
import pathlib
from typing import Literal

from mcp.server.fastmcp import FastMCP
from mcp.client.session import ClientSession
from mcp.client.sse import sse_client

# Repo's repertoires/ dir is the default sandbox: working PGNs live there (PROXY_DESIGN §6).
_DEFAULT_BASE = pathlib.Path(__file__).resolve().parent.parent / "repertoires"


def _backend_url() -> str:
    return os.environ.get("CHESS_MCP_URL", "http://localhost:8000/sse")


def _base_dir() -> pathlib.Path:
    """The one directory file paths are confined to. Read per call so the operator can retarget
    it without a restart, and so tests can point it at a tmp dir."""
    return pathlib.Path(os.environ.get("REPERTOIRE_DIR", _DEFAULT_BASE)).resolve()


def _max_bytes() -> int:
    """Mirror the backend's repertoire size cap (same env var) so oversize files are rejected
    before they are read whole."""
    return int(os.environ.get("MAX_REPERTOIRE_BYTES", "1000000"))


# ---------------------------------------------------------------------------
# Path confinement — resolve, then prove the real path sits under the base dir.
# Resolving first defeats ../ traversal and absolute escapes (/etc/passwd).
# ---------------------------------------------------------------------------


def _resolve_in_base(path: str) -> tuple[pathlib.Path | None, dict | None]:
    """Returns (resolved_path, None) when path is inside the base dir, else (None, error)."""
    base = _base_dir()
    p = pathlib.Path(path)
    if not p.is_absolute():
        p = base / p
    real = p.resolve()  # strict=False: missing final component is fine (export targets)
    if real != base and not real.is_relative_to(base):
        return None, {
            "error": "path_not_allowed",
            "reason": f"path must be within {base}",
        }
    return real, None


# ---------------------------------------------------------------------------
# Backend call — one-shot SSE session per call. Stateless and robust: the backend
# HANDLE, not the socket, is the unit of continuity (PROXY_DESIGN §7).
# ---------------------------------------------------------------------------


def _root_cause(exc: BaseException) -> str:
    """Unwrap an ExceptionGroup (anyio/httpx wrap connect failures) to a readable leaf."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return f"{type(exc).__name__}: {exc}"


def _payload(result) -> dict:
    """Extract a tool's dict payload from a CallToolResult. FastMCP serializes a dict return as
    JSON in a text content block (stable across versions); structuredContent is the typed mirror."""
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                continue
    sc = getattr(result, "structuredContent", None)
    if isinstance(sc, dict):
        return sc.get("result", sc)
    return {"error": "backend_unreachable", "reason": "unparseable backend response"}


async def _call_backend(tool: str, arguments: dict) -> dict:
    """Call one tool on the chess-analysis backend over SSE. Any transport/protocol failure
    becomes backend_unreachable; a tool's own {"error",...} payload is returned untouched."""
    url = _backend_url()
    try:
        async with sse_client(url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, arguments=arguments)
    except Exception as e:  # noqa: BLE001 — any failure to reach/run means backend is unreachable
        return {"error": "backend_unreachable", "reason": f"{url}: {_root_cause(e)}"}
    return _payload(result)


mcp = FastMCP("chess-files")


@mcp.tool()
async def load_repertoire_from_file(path: str, color: Literal["white", "black"]) -> dict:
    """
    Load a repertoire PGN from a file ON THE SERVER HOST and return a handle — the
    truncation-proof, token-cheap way to load. PREFER THIS over reading the file yourself and
    calling load_repertoire(pgn=...): the file is read here in full, the PGN never enters your
    context, and you get back only the handle.

    path: file path to the repertoire PGN, confined to REPERTOIRE_DIR (default the repo's
    repertoires/). Relative paths resolve under it; paths outside it are rejected. color: the
    side the repertoire is for.

    Returns the same handle as load_repertoire: repertoire_id (pass to the other repertoire
    tools), color, nodes, leaves, max_depth. Then: get_structural_profile,
    analyze_repertoire_congruence, find_repertoire_gaps, etc.

    Errors → {"error","reason"}: file_not_found / not_a_file / path_not_allowed / pgn_too_large
    / decode_error (file problems, caught here); invalid_pgn / invalid_color (relayed from the
    backend's validation); backend_unreachable (the chess-analysis server is down).
    """
    real, err = _resolve_in_base(path)
    if err:
        return err
    if not real.exists():
        return {"error": "file_not_found", "reason": f"{real} does not exist"}
    if not real.is_file():
        return {"error": "not_a_file", "reason": f"{real} is not a regular file"}
    if real.stat().st_size > _max_bytes():
        return {
            "error": "pgn_too_large",
            "reason": f"{real} exceeds {_max_bytes()} bytes",
        }
    try:
        pgn = real.read_text(encoding="utf-8")
    except UnicodeDecodeError as e:
        return {"error": "decode_error", "reason": f"{real} is not valid UTF-8: {e}"}
    if color not in ("white", "black"):
        return {"error": "invalid_color", "reason": "color must be 'white' or 'black'"}
    return await _call_backend("load_repertoire", {"pgn": pgn, "color": color})


@mcp.tool()
async def export_repertoire_to_file(repertoire_id: str, path: str) -> dict:
    """
    Serialize a repertoire's current tree to a PGN file ON THE SERVER HOST — the write mirror of
    load_repertoire_from_file, and the way to end an edit loop without the (potentially large)
    PGN passing through your context. PREFER THIS over export_repertoire + writing the string
    yourself.

    repertoire_id: handle from load_repertoire / load_repertoire_from_file / modify_repertoire_line.
    path: destination, confined to REPERTOIRE_DIR (its parent dir must already exist).

    Returns write metadata only — path (where it was written), bytes, leaves — NOT the PGN text.

    Errors → {"error","reason"}: path_not_allowed / not_a_file / file_not_found (the parent dir
    is missing); repertoire_not_found (relayed); backend_unreachable.
    """
    real, err = _resolve_in_base(path)
    if err:
        return err
    if real.is_dir():
        return {"error": "not_a_file", "reason": f"{real} is a directory"}
    if not real.parent.exists():
        return {"error": "file_not_found", "reason": f"parent dir {real.parent} does not exist"}
    data = await _call_backend("export_repertoire", {"repertoire_id": repertoire_id})
    if "error" in data:
        return data  # repertoire_not_found / backend_unreachable — nothing written
    pgn = data.get("pgn")
    if not isinstance(pgn, str):
        return {"error": "backend_unreachable", "reason": "export returned no pgn"}
    real.write_text(pgn, encoding="utf-8")
    return {"path": str(real), "bytes": len(pgn.encode("utf-8")), "leaves": data.get("leaves")}


if __name__ == "__main__":
    # stdio: the MCP client spawns this as a subprocess (it needs the host filesystem). The
    # backend connection is SSE, configured via CHESS_MCP_URL.
    mcp.run(transport="stdio")
