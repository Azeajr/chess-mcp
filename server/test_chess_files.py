"""Tests for chess_files.py — the host-side file proxy. Exercises the file-I/O guards,
base-dir confinement, and error relaying; the backend SSE call is mocked (a live :8000 is a
separate smoke test, per PROXY_DESIGN §10 step 4). The pure response parsers are tested directly.

Tools are async; sync tests drive them with asyncio.run (no pytest-asyncio dependency).

Run (from server/):  uv run pytest test_chess_files.py
"""

import asyncio
import json

import pytest

import chess_files as cf

REP = '[Event "t"]\n[Result "*"]\n\n1. d4 d5 2. c4 e6 *\n'


@pytest.fixture
def base(tmp_path, monkeypatch):
    """Confine the proxy to a throwaway dir for the test."""
    monkeypatch.setenv("REPERTOIRE_DIR", str(tmp_path))
    return tmp_path


def _run(coro):
    return asyncio.run(coro)


def _stub_backend(monkeypatch, payload, sink=None):
    """Replace the SSE call with a canned payload; record the (tool, args) it was asked for."""

    async def fake(tool, arguments):
        if sink is not None:
            sink.append((tool, arguments))
        return payload

    monkeypatch.setattr(cf, "_call_backend", fake)


# --- load_repertoire_from_file: happy paths ---


def test_load_reads_full_file_and_relays_handle(base, monkeypatch):
    p = base / "rep.pgn"
    p.write_text(REP, encoding="utf-8")
    sink: list = []
    _stub_backend(
        monkeypatch,
        {
            "repertoire_id": "abc",
            "color": "white",
            "nodes": 4,
            "leaves": 1,
            "max_depth": 4,
        },
        sink,
    )
    out = _run(cf.load_repertoire_from_file(str(p), "white"))
    assert out["repertoire_id"] == "abc"
    # the FULL file content is forwarded to the backend, untruncated
    assert sink == [("load_repertoire", {"pgn": REP, "color": "white"})]


def test_load_resolves_relative_path_under_base(base, monkeypatch):
    (base / "r.pgn").write_text(REP, encoding="utf-8")
    _stub_backend(monkeypatch, {"repertoire_id": "x"})
    out = _run(cf.load_repertoire_from_file("r.pgn", "black"))
    assert out["repertoire_id"] == "x"


# --- load_repertoire_from_file: file guards ---


def test_load_missing_file(base, monkeypatch):
    _stub_backend(monkeypatch, {"unexpected": True})
    out = _run(cf.load_repertoire_from_file(str(base / "nope.pgn"), "white"))
    assert out["error"] == "file_not_found"


def test_load_directory_is_not_a_file(base, monkeypatch):
    d = base / "sub"
    d.mkdir()
    _stub_backend(monkeypatch, {})
    out = _run(cf.load_repertoire_from_file(str(d), "white"))
    assert out["error"] == "not_a_file"


def test_load_traversal_blocked(base, monkeypatch):
    _stub_backend(monkeypatch, {})
    out = _run(cf.load_repertoire_from_file("../../../etc/passwd", "white"))
    assert out["error"] == "path_not_allowed"


def test_load_absolute_outside_base_blocked(base, monkeypatch):
    _stub_backend(monkeypatch, {})
    out = _run(cf.load_repertoire_from_file("/etc/passwd", "white"))
    assert out["error"] == "path_not_allowed"


def test_load_too_large(base, monkeypatch):
    monkeypatch.setenv("MAX_REPERTOIRE_BYTES", "10")
    p = base / "big.pgn"
    p.write_text(REP, encoding="utf-8")
    _stub_backend(monkeypatch, {})
    out = _run(cf.load_repertoire_from_file(str(p), "white"))
    assert out["error"] == "pgn_too_large"


def test_load_decode_error(base, monkeypatch):
    p = base / "bin.pgn"
    p.write_bytes(b"\xff\xfe\x00not utf8")
    _stub_backend(monkeypatch, {})
    out = _run(cf.load_repertoire_from_file(str(p), "white"))
    assert out["error"] == "decode_error"


def test_load_bad_color_fails_fast(base, monkeypatch):
    p = base / "r.pgn"
    p.write_text(REP, encoding="utf-8")
    _stub_backend(monkeypatch, {})
    out = _run(cf.load_repertoire_from_file(str(p), "purple"))
    assert out["error"] == "invalid_color"


def test_load_relays_backend_invalid_pgn(base, monkeypatch):
    # a genuinely corrupt file still fails loudly — relayed from the backend's #1 guard
    p = base / "r.pgn"
    p.write_text(REP, encoding="utf-8")
    _stub_backend(monkeypatch, {"error": "invalid_pgn", "reason": "illegal move g3"})
    out = _run(cf.load_repertoire_from_file(str(p), "white"))
    assert out["error"] == "invalid_pgn"


# --- export_repertoire_to_file ---


def test_export_writes_file_and_returns_metadata_only(base, monkeypatch):
    sink: list = []
    _stub_backend(
        monkeypatch, {"pgn": REP, "nodes": 4, "leaves": 1, "max_depth": 4}, sink
    )
    target = base / "out.pgn"
    out = _run(cf.export_repertoire_to_file("rid", str(target)))
    assert out["leaves"] == 1 and out["bytes"] == len(REP.encode("utf-8"))
    assert "pgn" not in out  # the PGN never comes back to the model
    assert target.read_text(encoding="utf-8") == REP
    assert sink == [("export_repertoire", {"repertoire_id": "rid"})]


def test_export_relays_not_found_and_writes_nothing(base, monkeypatch):
    _stub_backend(monkeypatch, {"error": "repertoire_not_found", "reason": "expired"})
    target = base / "out.pgn"
    out = _run(cf.export_repertoire_to_file("rid", str(target)))
    assert out["error"] == "repertoire_not_found"
    assert not target.exists()


def test_export_outside_base_blocked(base, monkeypatch):
    _stub_backend(monkeypatch, {"pgn": REP})
    out = _run(cf.export_repertoire_to_file("rid", "/tmp/evil.pgn"))
    assert out["error"] == "path_not_allowed"


def test_export_missing_parent_dir(base, monkeypatch):
    _stub_backend(monkeypatch, {"pgn": REP})
    out = _run(
        cf.export_repertoire_to_file("rid", str(base / "no" / "such" / "out.pgn"))
    )
    assert out["error"] == "file_not_found"


# --- pure response parsers (no backend needed) ---


def test_payload_parses_text_json():
    block = type("B", (), {"text": json.dumps({"repertoire_id": "z"})})()
    result = type("R", (), {"content": [block], "structuredContent": None})()
    assert cf._payload(result)["repertoire_id"] == "z"


def test_payload_structured_content_fallback():
    result = type("R", (), {"content": [], "structuredContent": {"result": {"a": 1}}})()
    assert cf._payload(result) == {"a": 1}


def test_payload_unparseable_is_unreachable():
    result = type("R", (), {"content": [], "structuredContent": None})()
    assert cf._payload(result)["error"] == "backend_unreachable"


def test_root_cause_unwraps_exception_group():
    eg = ExceptionGroup("boom", [ConnectionError("refused")])
    assert "refused" in cf._root_cause(eg)


def test_payload_skips_textless_and_bad_json_blocks():
    # Block order: no text -> unparseable text -> valid JSON. The parser must
    # walk past the first two and return the third.
    no_text = type("B", (), {"text": None})()
    bad = type("B", (), {"text": "not json"})()
    good = type("B", (), {"text": json.dumps({"ok": 1})})()
    result = type(
        "R", (), {"content": [no_text, bad, good], "structuredContent": None}
    )()
    assert cf._payload(result) == {"ok": 1}


def test_load_size_recheck_after_read(base, monkeypatch):
    # TOCTOU guard: the stat() check passes, then the bytes actually read exceed
    # the cap (file grew between stat and read). Simulated by a cap that shrinks
    # between the two _max_bytes() calls.
    p = base / "grow.pgn"
    p.write_text(REP, encoding="utf-8")
    _stub_backend(monkeypatch, {"unexpected": True})
    caps = iter((10**9, 1, 1))  # 3rd value: the error-reason f-string re-reads the cap
    monkeypatch.setattr(cf, "_max_bytes", lambda: next(caps))
    out = _run(cf.load_repertoire_from_file(str(p), "white"))
    assert out["error"] == "pgn_too_large"


def test_load_backend_down_is_unreachable(base, monkeypatch):
    # Real (unstubbed) SSE client against a closed loopback port: every transport
    # failure must collapse to the closed-set backend_unreachable, never raise.
    p = base / "r.pgn"
    p.write_text(REP, encoding="utf-8")
    monkeypatch.setenv("CHESS_MCP_URL", "http://127.0.0.1:59/sse")
    out = _run(cf.load_repertoire_from_file(str(p), "white"))
    assert out["error"] == "backend_unreachable"
    assert "127.0.0.1:59" in out["reason"]


def test_export_backend_payload_missing_pgn_writes_nothing(base, monkeypatch):
    _stub_backend(monkeypatch, {"nodes": 4})  # success-shaped but no pgn field
    target = base / "out.pgn"
    out = _run(cf.export_repertoire_to_file("rid", str(target)))
    assert out["error"] == "backend_unreachable"
    assert not target.exists()


def test_load_symlink_escape_blocked(base, monkeypatch, tmp_path_factory):
    # A symlink INSIDE the base dir pointing OUTSIDE it must be rejected: resolve()
    # follows the link, so containment is proven on the real target.
    outside = tmp_path_factory.mktemp("outside") / "secret.pgn"
    outside.write_text(REP, encoding="utf-8")
    (base / "alias.pgn").symlink_to(outside)
    _stub_backend(monkeypatch, {})
    out = _run(cf.load_repertoire_from_file("alias.pgn", "white"))
    assert out["error"] == "path_not_allowed"


def test_export_symlink_escape_writes_nothing(base, monkeypatch, tmp_path_factory):
    # A dangling symlink out of the base dir must not become a write outside it.
    outside_dir = tmp_path_factory.mktemp("outside2")
    link = base / "out.pgn"
    link.symlink_to(outside_dir / "evil.pgn")
    _stub_backend(monkeypatch, {"pgn": REP})
    out = _run(cf.export_repertoire_to_file("rid", str(link)))
    assert out["error"] == "path_not_allowed"
    assert not (outside_dir / "evil.pgn").exists()
