"""Stateful repertoire layer: variation-tree walking, the in-memory handle cache,
and engine-free congruence analysis.

The MCP contract stays a pure function of (repertoire_id, args) — the id is an input
key, not call-order-dependent session state (REPERTOIRE_DESIGN.md section 1). The cache
is the one sanctioned stateful exception: a large PGN re-sent on every call becomes a
short handle (MCP_DESIGN.md:80-83).

Engine-free throughout. The only engine-backed tool (suggest_complementary_lines) lives
in chess_mcp.py and calls the structural helpers here / in structure.py for scoring.
"""

import os
import time
import threading
import uuid
from collections import Counter, OrderedDict
from dataclasses import dataclass

import chess
import chess.pgn

import structure

MAX_REPERTOIRES = int(os.environ.get("MAX_REPERTOIRES", "16"))  # LRU cap
REPERTOIRE_TTL_S = int(os.environ.get("REPERTOIRE_TTL_S", "3600"))  # idle expiry, seconds

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}


# ---------------------------------------------------------------------------
# Variation-tree walking (the foundation every repertoire tool needs).
# python-chess parses variations into node.variations; nothing in the original
# server walked them — these do. All iterative (no recursion-depth risk on deep trees).
# ---------------------------------------------------------------------------


def iter_nodes(game: chess.pgn.Game):
    """Pre-order over every move-node in the tree (excludes the root)."""
    stack = list(reversed(game.variations))
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.variations))


def walk_leaves(game: chess.pgn.Game):
    """Yield every leaf node (end of a variation)."""
    for node in iter_nodes(game):
        if not node.variations:
            yield node


def tree_stats(game: chess.pgn.Game) -> tuple[int, int, int]:
    """(node_count, leaf_count, max_depth_in_plies) — for the load_repertoire summary."""
    nodes = leaves = max_depth = 0
    for node in iter_nodes(game):
        nodes += 1
        if not node.variations:
            leaves += 1
        depth = node.ply()
        if depth > max_depth:
            max_depth = depth
    return nodes, leaves, max_depth


def resolve_path(game: chess.pgn.Game, san_path: list[str]):
    """Follow a SAN route from the root, ply by ply. Returns the node, or None if any
    SAN is illegal in its position or no child plays it (Decision D3)."""
    node = game
    for san in san_path:
        try:
            move = node.board().parse_san(san)
        except ValueError:
            return None
        child = next((c for c in node.variations if c.move == move), None)
        if child is None:
            return None
        node = child
    return node


def san_path(node) -> list[str]:
    """Reconstruct the SAN route from the root to `node`."""
    moves: list[str] = []
    while node.parent is not None:
        moves.append(node.parent.board().san(node.move))
        node = node.parent
    moves.reverse()
    return moves


def _position_key(board: chess.Board) -> str:
    """Position identity ignoring move clocks: placement + turn + castling + en passant.
    Two move orders that reach the same position share this key (a transposition)."""
    return " ".join(board.fen().split()[:4])


def find_transpositions(game: chess.pgn.Game) -> list[dict]:
    """Positions the repertoire reaches by more than one distinct move order.

    Returns [{fen, paths: [<san_path>, ...]}] for each such position, largest groups
    first — the lines that converge, so the user can learn one move order for several.
    """
    groups: dict[str, dict] = {}
    for node in iter_nodes(game):
        key = _position_key(node.board())
        g = groups.setdefault(key, {"fen": node.board().fen(), "paths": []})
        g["paths"].append(san_path(node))
    converging = [g for g in groups.values() if len(g["paths"]) > 1]
    converging.sort(key=lambda g: -len(g["paths"]))
    return converging


# ---------------------------------------------------------------------------
# In-memory handle cache — bounded LRU + TTL (REPERTOIRE_DESIGN.md section 3).
# ---------------------------------------------------------------------------


@dataclass
class _Repertoire:
    game: chess.pgn.Game
    color: chess.Color
    created: float
    touched: float
    nodes: int
    leaves: int
    max_depth: int


_CACHE: "OrderedDict[str, _Repertoire]" = OrderedDict()
_LOCK = threading.Lock()


def _evict_locked(now: float) -> None:
    """Caller must hold _LOCK. Drop expired entries, then enforce the LRU cap."""
    expired = [rid for rid, rep in _CACHE.items() if now - rep.touched > REPERTOIRE_TTL_S]
    for rid in expired:
        del _CACHE[rid]
    while len(_CACHE) > MAX_REPERTOIRES:
        _CACHE.popitem(last=False)  # evict least-recently-used


def store_repertoire(game: chess.pgn.Game, color: chess.Color) -> dict:
    """Cache a parsed repertoire, return its handle + tree stats."""
    nodes, leaves, max_depth = tree_stats(game)
    rid = uuid.uuid4().hex
    now = time.time()
    with _LOCK:
        _CACHE[rid] = _Repertoire(game, color, now, now, nodes, leaves, max_depth)
        _CACHE.move_to_end(rid)
        _evict_locked(now)
    return {
        "repertoire_id": rid,
        "color": "white" if color == chess.WHITE else "black",
        "nodes": nodes,
        "leaves": leaves,
        "max_depth": max_depth,
    }


def get_repertoire(repertoire_id: str) -> _Repertoire | None:
    """Fetch by handle; None if missing or expired (also evicts on expiry)."""
    now = time.time()
    with _LOCK:
        rep = _CACHE.get(repertoire_id)
        if rep is None:
            return None
        if now - rep.touched > REPERTOIRE_TTL_S:
            del _CACHE[repertoire_id]
            return None
        rep.touched = now
        _CACHE.move_to_end(repertoire_id)
        return rep


# ---------------------------------------------------------------------------
# Aggregate structural fingerprint (get_structural_profile, variation_path=None).
# ---------------------------------------------------------------------------


def aggregate_profile(rep: _Repertoire) -> dict:
    """Structural fingerprint over every leaf of the repertoire."""
    leaves = list(walk_leaves(rep.game))
    n = len(leaves)
    struct_counts: dict[str, list] = {}
    open_tally: Counter = Counter()
    half_open_tally: Counter = Counter()
    center_counts: Counter = Counter()

    for leaf in leaves:
        board = leaf.board()
        cls = structure.classify_structure(board)
        sc = cls["structure_class"]
        agg = struct_counts.setdefault(sc, [0, 0.0])
        agg[0] += 1
        agg[1] += cls["confidence"]
        open_tally.update(structure.get_open_files(board))
        half_open_tally.update(structure.get_half_open_files(board, rep.color))
        center_counts.update([structure.center_state(board)])

    denom = n or 1
    structures = sorted(
        (
            {"structure_class": k, "count": v[0], "avg_confidence": round(v[1] / v[0], 2)}
            for k, v in struct_counts.items()
        ),
        key=lambda d: (-d["count"], d["structure_class"]),
    )
    return {
        "leaves_analyzed": n,
        "structures": structures,
        "center_distribution": dict(center_counts),
        "common_open_files": sorted(f for f, c in open_tally.items() if c / denom >= 0.5),
        "common_half_open_files": sorted(
            f for f, c in half_open_tally.items() if c / denom >= 0.5
        ),
    }


def profile_structure_shares(rep: _Repertoire) -> dict[str, float]:
    """structure_class -> share of leaves reaching it. Used to score familiarity for
    suggest_complementary_lines (Mode low_memorization)."""
    leaves = list(walk_leaves(rep.game))
    counts = Counter(
        structure.classify_structure(leaf.board())["structure_class"] for leaf in leaves
    )
    denom = len(leaves) or 1
    return {sc: count / denom for sc, count in counts.items()}


# ---------------------------------------------------------------------------
# Congruence — engine-free thematic consistency checks (summary→detail).
# Each incongruency carries the leaf variation_path(s) so the agent can drill via
# get_structural_profile (no unreachable handle, MCP_DESIGN.md:181).
# ---------------------------------------------------------------------------


def analyze_congruence(rep: _Repertoire, min_severity: str, limit: int) -> dict:
    """Flag thematic inconsistencies across the repertoire's leaves."""
    # Collect structural + pawn data for every leaf
    data = []
    for leaf in walk_leaves(rep.game):
        board = leaf.board()
        data.append(
            {
                "path": san_path(leaf),
                "structure": structure.classify_structure(board)["structure_class"],
                "isolated": structure.get_isolated_pawns(board, rep.color),
                "doubled": structure.get_doubled_pawns(board, rep.color),
                "center": structure.center_state(board),
            }
        )
    n = len(data)
    incongruencies: list[dict] = []

    # 1. structure_outlier — a line veering off the repertoire's dominant structure.
    known = [d for d in data if d["structure"] != "unknown"]
    if not known:
        pass  # No known structures → skip this check
    else:
        sc_counts = Counter(d["structure"] for d in known)
        dominant, dom_count = sc_counts.most_common(1)[0]
        dom_share = dom_count / len(known)
        if dom_share >= 0.5:
            # Dominant structure found; flag outliers
            for d in known:
                if d["structure"] == dominant:
                    continue  # Early return for non-outliers
                incongruencies.append(
                    {
                        "type": "structure_outlier",
                        "severity": "high" if dom_share > 0.8 else "medium",
                        "description": (
                            f"Most lines reach a {dominant} structure; this line reaches "
                            f"{d['structure']} — a separate middlegame plan to learn."
                        ),
                        "paths": [d["path"]],
                    }
                )

    # 2. weakness_inconsistency — accepting a pawn weakness against the repertoire's grain.
    weak = [d for d in data if d["isolated"] or d["doubled"]]
    if n == 0 or len(weak) == 0 or len(weak) >= n * 0.5:
        pass  # Skip: no weaknesses, all weak, or majority weak → no inconsistency signal
    else:
        # Minority of lines have weaknesses → flag each as inconsistent
        for d in weak:
            kinds = [k for k, present in (("doubled", d["doubled"]), ("isolated", d["isolated"])) if present]
            incongruencies.append(
                {
                    "type": "weakness_inconsistency",
                    "severity": "medium",
                    "description": (
                        f"Most lines keep a sound pawn structure, but here you accept "
                        f"{'/'.join(kinds)} pawns — inconsistent structural comfort."
                    ),
                    "paths": [d["path"]],
                }
            )

    # 3. center_inconsistency — repertoire split between locking and opening the center.
    centers = Counter(d["center"] for d in data)
    locked, opened = centers.get("locked", 0), centers.get("open", 0)
    if n == 0:
        pass  # Skip: no leaves
    elif locked / n < 0.25 or opened / n < 0.25:
        pass  # Skip: one style dominates → no split
    else:
        # Both locked and open are significant → flag the split
        examples = [d["path"] for d in data if d["center"] == "locked"][:2]
        examples += [d["path"] for d in data if d["center"] == "open"][:2]
        incongruencies.append(
            {
                "type": "center_inconsistency",
                "severity": "low",
                "description": (
                    f"Center handling is split: {locked} line(s) lock the center, {opened} "
                    f"open it — differing strategic commitments across the repertoire."
                ),
                "paths": examples,
            }
        )

    # Filter and sort by severity; cap to limit
    floor = _SEVERITY_RANK[min_severity]
    filtered = [x for x in incongruencies if _SEVERITY_RANK[x["severity"]] >= floor]
    filtered.sort(key=lambda x: -_SEVERITY_RANK[x["severity"]])

    by_type = Counter(x["type"] for x in filtered)
    return {
        "total_flagged": len(filtered),
        "leaves_analyzed": n,
        "by_type": dict(by_type),
        "incongruencies": filtered[:limit],
    }
