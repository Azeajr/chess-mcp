# PyPI Packaging + Registry Listing Design

Goal: make the server installable without cloning — `uvx chess-mcp` / `pip install chess-mcp` —
and listed on Smithery + Glama. Issue #27. Requirements:

- **R1** — `pip install chess-mcp && chess-mcp` starts the server; `uvx chess-mcp` works with no
  prior install.
- **R2** — package on PyPI with correct metadata/classifiers; publish on tag via CI.
- **R3** — Smithery + Glama listings.

This is the highest-leverage adoption lever and the only remaining priority issue, but it is also
the most invasive change: it rewrites how every module imports its siblings and how the server is
launched (which is in users' MCP client configs today). It must wrap the *final* code — done after
the 7 feature merges (it is).

---

## Current posture

- Flat modules in `server/`: `chess_mcp.py` (entry, ends in `if __name__=="__main__": mcp.run(...)`),
  `structure.py`, `repertoire.py`, `openings.py` (+ `openings.tsv` data), `apiclient.py`,
  `evalcache.py`, `boardwidget.py`, and `chess_files.py` (the host-side stdio proxy — separate
  concern). Imports are **flat**: `import structure`, `import repertoire`, … (19 such statements
  across 7 files incl. tests + `evals/`).
- `server/pyproject.toml`: name `chess-mcp` v0.2.16, hatchling backend, requires-python ≥3.14.
  No `[project.scripts]`, no classifiers, no package config (nothing is actually packaged yet).
- Launch today: `uv run chess_mcp.py` (in `install.sh`, the systemd unit, and the Docker `CMD`);
  MCP clients point at the file. `.mcp.json` configures the local client.
- CI exists: `.github/workflows/ci.yml` (tests). No publish workflow.

## Gaps

| # | Gap | Req |
|---|-----|-----|
| G1 | Nothing is importable as a package; flat top-level modules can't ship to PyPI cleanly (namespace collisions: `structure`, `openings`). | R1 |
| G2 | No console-script entry point. | R1 |
| G3 | No publish CI, no classifiers/README-as-long-description. | R2 |
| G4 | No `smithery.yaml`; not submitted to Glama. | R3 |

---

## Decisions

### D1 — Proper `chess_mcp` package (src layout)

Move the flat modules into a package so they ship under one namespace (no top-level `structure`
colliding on PyPI):

```
server/
  pyproject.toml
  src/chess_mcp/
    __init__.py        # exposes __version__
    __main__.py        # `python -m chess_mcp` → server.main()
    server.py          # was chess_mcp.py; add def main()
    structure.py  repertoire.py  openings.py  openings.tsv
    apiclient.py  evalcache.py   boardwidget.py
    files.py           # was chess_files.py (host proxy)
  tests/               # was server/test_*.py
```

Intra-package imports become `from chess_mcp import structure` (absolute, explicit) — chosen over
relative `from . import structure` because the modules also run under pytest and `evals/`, and
absolute imports read the same everywhere. `openings.tsv` ships as package data
(`openings.py` already locates it relative to its own file).

*Rejected:* shipping the flat modules as top-level `py-modules` (no package). `uvx` would work, but
installing generic names (`structure`, `openings`, `repertoire`) into site-packages invites
collisions and is poor hygiene for a public package. The one-time import rewrite (19 lines) buys a
clean namespace.

### D2 — Entry points + backward-compat for existing launches

```toml
[project.scripts]
chess-mcp   = "chess_mcp.server:main"
chess-files = "chess_mcp.files:main"   # host proxy, if it has a main
```

`server.py` gets `def main()` wrapping the current `if __name__=="__main__"` body (transport env
handling unchanged). **Breaking-change mitigation** (existing users launch `uv run chess_mcp.py`):
- keep `python -m chess_mcp` working via `__main__.py`;
- update `install.sh`, the systemd unit, Docker `CMD` (`["chess-mcp"]`), `.mcp.json`, and the README
  to the new invocation;
- README "Migration" note: `uv run chess_mcp.py` → `uvx chess-mcp` (or `python -m chess_mcp`).

### D3 — pyproject metadata

Add `description`, `readme = "README.md"` (long description), `license`, `authors`, `keywords`,
`classifiers` (Python 3.14, MIT/own license, "Topic :: Games/Entertainment :: Board Games", MCP),
`urls` (repo). Configure hatchling: `[tool.hatch.build.targets.wheel] packages = ["src/chess_mcp"]`
and include `openings.tsv`. Bump version (0.2.16 → 0.3.0 — new tool surface + layout).

### D4 — Publish CI (Phase B, needs the user)

Add `.github/workflows/release.yml`: on `v*` tag → `uv build` → publish to PyPI via **trusted
publishing (OIDC)** — no API token in the repo. This requires the **user** to (a) create the PyPI
project / configure the trusted publisher, (b) push the tag. I can write the workflow; I cannot
create the PyPI account or release.

### D5 — Registries are outward-facing → deferred, user-driven (Phase C)

`smithery.yaml` I can author. The actual **Smithery PR + Glama submission publish the project to
third-party directories** — outward-facing actions that need a live PyPI release first and the
user's account/approval. I will not submit them autonomously; I prepare the files and hand off.

---

## Phasing

- **Phase A (now, in-repo, fully verifiable):** D1 restructure + D2 entry points + D3 metadata.
  Verify: `uv build` produces a wheel; `uvx --from ./dist/*.whl chess-mcp` (or `uv run chess-mcp`)
  starts; full test suite passes against the new layout; Docker image builds + the engine smoke
  still passes; `python -m chess_mcp` works.
- **Phase B:** `release.yml` (trusted publishing). Merge, then the user configures PyPI + tags.
- **Phase C:** `smithery.yaml` + README badges; user submits to Smithery/Glama after the first
  release is live.

## Test plan

- `uv run pytest` (engine-free) green after the import rewrite (tests move to `tests/`, imports →
  `from chess_mcp import …`).
- `uv build` → wheel; install into a clean venv; `chess-mcp --help`/start smoke; `python -m chess_mcp`.
- Docker: rebuild, re-run the engine smoke (evaluate_position / tablebase / engine_move /
  batch_review) — unchanged behavior.
- `evals/` imports updated; snapshot regen is separate housekeeping (tracked).

## Out of scope / follow-ups

- evals snapshot + MCP_DESIGN token table regen (tool count 19→30) — Docker, separate.
- The actual PyPI release + registry submissions (Phase B/C) — user-driven.
