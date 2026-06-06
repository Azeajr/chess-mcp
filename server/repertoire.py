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
REPERTOIRE_TTL_S = int(
    os.environ.get("REPERTOIRE_TTL_S", "3600")
)  # idle expiry, seconds

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}

BOOL_THEMES = (
    "fianchetto_white",
    "fianchetto_black",
    "minority_attack_white",
    "minority_attack_black",
    "flank_vs_center",
)


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
# Multi-game merge. A Chesstempo repertoire export is one [Event] block per opening
# (e.g. a Black repertoire = Caro-Kann + Nimzo + Anti-English + ...). Reading only the
# first game silently drops the rest; merging them into one variation forest lets every
# repertoire tool (walker, transpositions, congruence) see the whole repertoire.
# ---------------------------------------------------------------------------


def _merge_into(base: chess.pgn.Game, other: chess.pgn.Game) -> None:
    """Graft `other`'s subtree onto `base` (both at the same position), merging shared
    moves so repeated move orders across games collapse into one node instead of
    duplicating a root child (which would confuse resolve_path). Iterative — no
    recursion-depth risk on deep trees."""
    stack = [(base, other)]
    while stack:
        dest, src = stack.pop()
        for src_child in src.variations:
            dest_child = next(
                (c for c in dest.variations if c.move == src_child.move), None
            )
            if dest_child is None:
                src_child.parent = dest  # re-parent the whole subtree onto base
                dest.variations.append(src_child)
            else:
                stack.append((dest_child, src_child))


def merge_games(games: list[chess.pgn.Game]) -> chess.pgn.Game:
    """Merge a multi-game PGN into a single variation forest under one root.

    Games sharing the standard starting position are grafted onto the first game's root.
    A game with a non-standard start (FEN/SetUp header) cannot share that root and is
    skipped — repertoire openings start from the initial position. Returns the first game
    with the others merged in (the single-game case returns it unchanged)."""
    base = games[0]
    base_fen = base.board().fen()
    for g in games[1:]:
        if g.board().fen() != base_fen:
            continue  # non-standard start position — cannot graft onto the base root
        _merge_into(base, g)
    return base


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
    expired = [
        rid for rid, rep in _CACHE.items() if now - rep.touched > REPERTOIRE_TTL_S
    ]
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
    # Theme rollup — so leaves that classify as `unknown` (e.g. fianchetto/system
    # English) still contribute their structural DNA to the aggregate (A).
    theme_tally: Counter = Counter()
    space_white_sum = space_black_sum = 0

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

        t = structure.themes(board, rep.color)
        theme_tally.update(k for k in BOOL_THEMES if t[k])
        if t["fianchetto_white"] and t["fianchetto_black"]:
            theme_tally["double_fianchetto"] += 1
        for k in ("wing_majority_white", "wing_majority_black", "color_complex"):
            if t[k] is not None:
                theme_tally[f"{k}:{t[k]}"] += 1
        space_white_sum += t["space_white"]
        space_black_sum += t["space_black"]

    denom = n or 1
    structures = sorted(
        (
            {
                "structure_class": k,
                "count": v[0],
                "avg_confidence": round(v[1] / v[0], 2),
            }
            for k, v in struct_counts.items()
        ),
        key=lambda d: (-d["count"], d["structure_class"]),
    )
    themes = {k: theme_tally[k] for k in sorted(theme_tally)}  # leaf-count per theme
    themes["avg_space_white"] = round(space_white_sum / denom, 1)
    themes["avg_space_black"] = round(space_black_sum / denom, 1)
    return {
        "leaves_analyzed": n,
        "structures": structures,
        "themes": themes,
        "center_distribution": dict(center_counts),
        "common_open_files": sorted(
            f for f, c in open_tally.items() if c / denom >= 0.5
        ),
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


def opponent_reply_nodes(rep: _Repertoire) -> list[dict]:
    """Nodes where the OPPONENT is to move and the repertoire already prepares >= 1 reply.

    The decision points a completeness scan cares about (find_repertoire_gaps): a frontier
    leaf has no replies yet, so every opponent move there is trivially "uncovered" — noise;
    an internal opponent-to-move node is where a missed strong reply is a real gap.

    Transposition-aware: when multiple move orders reach the same position, covered sets
    are merged so a move answered in one branch is not flagged as a gap in another.
    Positions reached by multiple paths are deduplicated; `transposition_paths` lists all
    paths that converge there (len > 1 means it's a transposition endpoint).

    Returns [{path, board, covered: {uci,...}, transposition_paths: [path,...]}]
    shallowest first. Engine-free — the engine pass is the caller's.
    """
    key_to_entry: dict[str, dict] = {}
    for node in [rep.game, *iter_nodes(rep.game)]:
        board = node.board()
        if board.turn == rep.color:  # player's move — not a coverage gap
            continue
        if not node.variations:  # frontier leaf — no replies prepared yet
            continue
        key = _position_key(board)
        covered = {child.move.uci() for child in node.variations}
        path = san_path(node)
        if key not in key_to_entry:
            key_to_entry[key] = {
                "path": path,
                "board": board,
                "covered": covered,
                "transposition_paths": [path],
            }
        else:
            key_to_entry[key]["covered"].update(covered)
            key_to_entry[key]["transposition_paths"].append(path)

    out = list(key_to_entry.values())
    out.sort(key=lambda d: len(d["path"]))
    return out


def coverage_report(rep: _Repertoire, limit: int) -> dict:
    """Engine-free tree-shape hygiene over the repertoire's leaves.

    Headline signal: a "dangling" line — a leaf where it is the PLAYER's turn, so the line
    stops exactly where a prepared move is owed (a real hole). A leaf where the opponent is to
    move is a natural frontier (move played, paused) → frontier_count, not flagged. Returns
    leaf counts, the dangling lines (with drill-down path + ply), and depth hints.
    """
    leaves = list(walk_leaves(rep.game))
    dangling = [leaf for leaf in leaves if leaf.board().turn == rep.color]
    depths = [leaf.ply() for leaf in leaves]
    return {
        "leaves": len(leaves),
        "dangling_count": len(dangling),
        "dangling_lines": [
            {"path": san_path(leaf), "ply": leaf.ply()} for leaf in dangling[:limit]
        ],
        "frontier_count": len(leaves) - len(dangling),
        "max_depth": max(depths) if depths else 0,
        "shallowest_leaf_ply": min(depths) if depths else 0,
    }


# ---------------------------------------------------------------------------
# Congruence — engine-free thematic consistency checks (summary→detail).
# Each incongruency carries the leaf variation_path(s) so the agent can drill via
# get_structural_profile (no unreachable handle, MCP_DESIGN.md:181).
# ---------------------------------------------------------------------------


def analyze_congruence(
    rep: _Repertoire,
    min_severity: str,
    limit: int,
    acknowledged_weaknesses: list | None = None,
) -> dict:
    """Flag thematic inconsistencies across the repertoire's leaves.

    acknowledged_weaknesses: list of variation paths (each a list of SAN strings) whose
    weakness_inconsistency flags should be downgraded to severity "low" with
    acknowledged:true — for known positional systems the user accepts intentionally.
    """
    ack_set: set[tuple] = {tuple(p) for p in (acknowledged_weaknesses or [])}

    # Collect structural + pawn data for every leaf
    data = []
    for leaf in walk_leaves(rep.game):
        board = leaf.board()
        t = structure.themes(board, rep.color)
        data.append(
            {
                "path": san_path(leaf),
                "_pos_key": _position_key(board),
                "structure": structure.classify_structure(board)["structure_class"],
                "isolated": structure.get_isolated_pawns(board, rep.color),
                "doubled": structure.get_doubled_pawns(board, rep.color),
                "center": structure.center_state(board),
                "theme_tags": {k for k in BOOL_THEMES if t[k]},
            }
        )
    n = len(data)

    # Transposition endpoints are global (a position reached by multiple move orders),
    # computed once over the whole tree and shared by every opening group (Issue #9).
    _key_counts: Counter = Counter(
        _position_key(node.board()) for node in iter_nodes(rep.game)
    )
    transposition_keys = {k for k, c in _key_counts.items() if c > 1}

    def _checks_for(group: list[dict]) -> list[dict]:
        """Run the three congruence checks within ONE opening's leaves (Issue #14).

        A repertoire spanning several openings (one answer per opponent first move) has no
        single structural grain; judging a Caro IQP line against Nimzo leaves is noise. So
        each leaf is compared only to its own opening's siblings."""
        gn = len(group)
        found: list[dict] = []

        # 1. structure_outlier — a line veering off the opening's dominant structure.
        known = [d for d in group if d["structure"] != "unknown"]
        known_share = len(known) / gn if gn else 0.0

        if known_share >= 0.5:
            # Enough named structures: use the named-structure outlier check.
            sc_counts = Counter(d["structure"] for d in known)
            dominant, dom_count = sc_counts.most_common(1)[0]
            dom_share = dom_count / len(known)
            if dom_share >= 0.5:
                for d in known:
                    if d["structure"] == dominant:
                        continue
                    found.append(
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
        elif gn > 0:
            # 1b. Theme-based fallback: most leaves are unknown — use dominant bool theme
            # as a structural proxy. A leaf that lacks the dominant theme is an outlier even
            # when no named structure can be assigned (e.g. hypermodern English repertoires
            # where fianchetto_white fires on most leaves but structure_class is unknown).
            theme_counts = Counter(theme for d in group for theme in d["theme_tags"])
            dominant_theme_candidates = [
                (t, c) for t, c in theme_counts.items() if c / gn >= 0.5
            ]
            if dominant_theme_candidates:
                dominant_theme, _ = max(dominant_theme_candidates, key=lambda x: x[1])
                dom_theme_share = theme_counts[dominant_theme] / gn
                for d in group:
                    if dominant_theme in d["theme_tags"]:
                        continue
                    # Transposition endpoint stubs reach a position that a longer line also
                    # reaches by a different move order. The stub ends before the dominant
                    # theme is played — but it's covered structurally via the longer path.
                    # Suppress outlier flags for these nodes (Issue #9).
                    if d["_pos_key"] in transposition_keys:
                        continue
                    found.append(
                        {
                            "type": "structure_outlier",
                            "severity": "high" if dom_theme_share > 0.8 else "medium",
                            "description": (
                                f"Most lines share the '{dominant_theme}' theme; this line "
                                f"lacks it — a structural inconsistency in the repertoire's DNA."
                            ),
                            "paths": [d["path"]],
                            "source": "theme",
                        }
                    )

        # 2. weakness_inconsistency — accepting a pawn weakness against the opening's grain.
        weak = [d for d in group if d["isolated"] or d["doubled"]]
        if gn == 0 or len(weak) == 0 or len(weak) >= gn * 0.5:
            pass  # Skip: no weaknesses, all weak, or majority weak → no signal
        else:
            # Minority of lines have weaknesses → flag each as inconsistent
            for d in weak:
                kinds = [
                    k
                    for k, present in (
                        ("doubled", d["doubled"]),
                        ("isolated", d["isolated"]),
                    )
                    if present
                ]
                acknowledged = bool(ack_set and tuple(d["path"]) in ack_set)
                severity = "low" if acknowledged else "medium"
                entry: dict = {
                    "type": "weakness_inconsistency",
                    "severity": severity,
                    "description": (
                        f"Most lines keep a sound pawn structure, but here you accept "
                        f"{'/'.join(kinds)} pawns — inconsistent structural comfort."
                    ),
                    "paths": [d["path"]],
                }
                if acknowledged:
                    entry["acknowledged"] = True
                found.append(entry)

        # 3. center_inconsistency — opening split between locking and opening the center.
        centers = Counter(d["center"] for d in group)
        locked, opened = centers.get("locked", 0), centers.get("open", 0)
        if gn == 0:
            pass  # Skip: no leaves
        elif locked / gn < 0.25 or opened / gn < 0.25:
            pass  # Skip: one style dominates → no split
        else:
            # Both locked and open are significant → flag the split
            examples = [d["path"] for d in group if d["center"] == "locked"][:2]
            examples += [d["path"] for d in group if d["center"] == "open"][:2]
            found.append(
                {
                    "type": "center_inconsistency",
                    "severity": "low",
                    "description": (
                        f"Center handling is split: {locked} line(s) lock the center, "
                        f"{opened} open it — differing strategic commitments."
                    ),
                    "paths": examples,
                }
            )
        return found

    # Group leaves by opening (opponent's first move) and judge each leaf against its own
    # opening's siblings. A single-opening repertoire is one group → identical to before.
    groups: dict[str, list[dict]] = {}
    for d in data:
        groups.setdefault(d["path"][0] if d["path"] else "", []).append(d)
    incongruencies: list[dict] = []
    for group in groups.values():
        incongruencies.extend(_checks_for(group))

    # Filter and sort by severity; cap to limit
    floor = _SEVERITY_RANK[min_severity]
    filtered = [x for x in incongruencies if _SEVERITY_RANK[x["severity"]] >= floor]
    filtered.sort(key=lambda x: -_SEVERITY_RANK[x["severity"]])

    # Acknowledged items are downgraded (severity: low, acknowledged: true) — they are
    # still included in incongruencies for visibility but excluded from the headline
    # counts so callers can see how many real (unacknowledged) issues remain (Issue #10).
    acknowledged_count = sum(1 for x in filtered if x.get("acknowledged"))
    unacknowledged = [x for x in filtered if not x.get("acknowledged")]
    by_type = Counter(x["type"] for x in unacknowledged)
    by_type_ack = Counter(x["type"] for x in filtered if x.get("acknowledged"))
    return {
        "total_flagged": len(unacknowledged),
        "acknowledged_count": acknowledged_count,
        "leaves_analyzed": n,
        "by_type": dict(by_type),
        "by_type_acknowledged": dict(by_type_ack),
        "incongruencies": filtered[:limit],
    }
