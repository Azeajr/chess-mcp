"""Stateful repertoire layer: variation-tree walking, the in-memory handle cache,
and engine-free congruence analysis.

The MCP contract stays a pure function of (repertoire_id, args) — the id is an input
key, not call-order-dependent session state (REPERTOIRE_DESIGN.md section 1). The cache
is the one sanctioned stateful exception: a large PGN re-sent on every call becomes a
short handle (MCP_DESIGN.md:80-83).

Engine-free throughout. The only engine-backed tool (suggest_complementary_lines) lives
in chess_mcp.py and calls the structural helpers here / in structure.py for scoring.
"""

import copy
import os
import time
import threading
import uuid
from collections import Counter, OrderedDict
from dataclasses import dataclass

import chess
import chess.pgn

import structure
import openings

MAX_REPERTOIRES = int(os.environ.get("MAX_REPERTOIRES", "16"))  # LRU cap
REPERTOIRE_TTL_S = int(
    os.environ.get("REPERTOIRE_TTL_S", "3600")
)  # idle expiry, seconds

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}
# A bool theme is the repertoire's structural "grain" only when it covers a STRONG
# majority of an opening's leaves. A mere plurality (e.g. fianchetto_black ~55% of a
# multi-system Sicilian) is not a grain — flagging the rest as outliers is noise (#21).
_THEME_DOMINANCE = 0.66
# Illustrative-line detection (#18, see ILLUSTRATIVE_LINE_DESIGN.md). NAG = mistake/blunder/
# dubious move glyphs ($2/$4/$6) — the authoritative Tier-1 signal.
_NAG_BAD = {chess.pgn.NAG_MISTAKE, chess.pgn.NAG_BLUNDER, chess.pgn.NAG_DUBIOUS_MOVE}

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


# How far to follow an engine PV when checking whether an "uncovered" opponent move is
# really a move-order transposition back into prepared territory (REPERTOIRE_DESIGN.md §13).
_FWD_TRANSP_PLIES = 12


def continued_position_key_set(game: chess.pgn.Game) -> set[str]:
    """Position keys of every INTERIOR node (>= 1 reply) — the positions where the
    repertoire continues. Membership-only form of continued_position_keys (no SAN-path
    labels, so no per-node path reconstruction). A leaf whose key is in this set is a
    transposition stub: the same position carries on via another move order."""
    return {_position_key(node.board()) for node in iter_nodes(game) if node.variations}


def continued_position_keys(game: chess.pgn.Game) -> dict[str, list[str]]:
    """{position_key: san_path} for every INTERIOR node (>= 1 reply) — the positions where
    the repertoire continues. A forward line that transposes into one of these has rejoined
    prepared territory. Keyed by `_position_key` (exact position identity); shallowest path
    wins as the human-readable label. Used by the gap finder's forward-transposition check."""
    out: dict[str, list[str]] = {}
    for node in iter_nodes(game):
        if not node.variations:
            continue
        path = san_path(node)
        key = _position_key(node.board())
        if key not in out or len(path) < len(out[key]):
            out[key] = path
    return out


def pv_rejoins_prep(
    board: chess.Board,
    pv: list[chess.Move],
    continued_keys: dict[str, list[str]],
    max_plies: int = _FWD_TRANSP_PLIES,
) -> list[str] | None:
    """Walk the engine PV from `board` (an opponent-to-move gap position; pv[0] is the
    uncovered opponent move) and return the first prepared position it transposes into, or
    None. If the engine's best line re-enters the tree within max_plies, the "gap" is a
    move-order transposition, not a real hole (REPERTOIRE_DESIGN.md §13). Pure — no engine IO."""
    b = board.copy(stack=False)
    for move in pv[:max_plies]:
        if move not in b.legal_moves:  # a PV from a transposed search can desync — stop
            break
        b.push(move)
        path = continued_keys.get(_position_key(b))
        if path is not None:
            return path
    return None


# ---------------------------------------------------------------------------
# Illustrative-line detection (Issue #18). A gamebook study embeds "wrong-answer" side
# variations; the cheap (engine-free) tiers live here, the engine tier in chess_mcp.py.
# See ILLUSTRATIVE_LINE_DESIGN.md.
# ---------------------------------------------------------------------------


def _subtree(node):
    """Pre-order over `node` and all its descendants (includes `node` itself)."""
    stack = [node]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(n.variations)


def _side_variations(game: chess.pgn.Game):
    """Yield (parent, node) for every non-mainline child (parent.variations[0] is the
    recommended mainline; the rest are side variations)."""
    for node in iter_nodes(game):
        p = node.parent
        if p is not None and p.variations and p.variations[0] is not node:
            yield p, node


def leaves_under(node) -> list:
    """Every leaf in `node`'s subtree."""
    return [n for n in _subtree(node) if not n.variations]


def nag_illustrative_nodes(game: chess.pgn.Game) -> list[dict]:
    """Tier 1 (engine-free, authoritative): side variations whose move carries a
    mistake/blunder/dubious NAG ($2/$4/$6). Returns [{node, path, reason="nag"}].

    A bare structural "stub" signal (a short player-side side line) was tried as a standalone
    verdict but over-flagged: in a merged multi-chapter forest a legitimate short chapter
    becomes a side branch, and dense theory trees are full of short legitimate sub-variations
    (#18 retro v2). So stubs are no longer a verdict — every player-side side variation is an
    engine *candidate* (player_side_variations) and only confirmed-losing lines are flagged."""
    return [
        {"node": node, "path": san_path(node), "reason": "nag"}
        for _, node in _side_variations(game)
        if node.nags & _NAG_BAD
    ]


def player_side_variations(
    game: chess.pgn.Game, color: chess.Color, exclude_ids: set
) -> list[dict]:
    """Every player-to-move side variation (the player chose a non-mainline move) not already
    excluded — the engine tier (#18 Tier 3, in chess_mcp.py) checks which are losing demos.
    Player-side only: a short OPPONENT side line is the author addressing an opponent try, not
    a wrong answer. Returns [{parent, node, path}]."""
    return [
        {"parent": parent, "node": node, "path": san_path(node)}
        for parent, node in _side_variations(game)
        if id(node) not in exclude_ids and parent.board().turn == color
    ]


def path_excluded(path: list[str], exclude_paths: list) -> bool:
    """True if `path` lies under (is prefixed by) any path in `exclude_paths` — used to drop
    illustrative side-lines (from classify_illustrative_lines) out of congruence / gap scans."""
    return any(list(path[: len(p)]) == list(p) for p in exclude_paths)


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
    with the others merged in (the single-game case returns it unchanged).

    CONSUMES its inputs: grafting re-parents nodes from games[1:] into the base tree,
    so the input games must not be walked or reused after this call — keep only the
    returned game."""
    base = games[0]
    base_fen = base.board().fen()
    for g in games[1:]:
        if g.board().fen() != base_fen:
            continue  # non-standard start position — cannot graft onto the base root
        _merge_into(base, g)
    return base


# ---------------------------------------------------------------------------
# Tree mutation — pure clone-on-write (REPERTOIRE_DESIGN.md section 9). Each editor deep-copies
# the tree, edits the copy, and returns it; the source is never touched, so the source
# repertoire_id keeps resolving to the unmodified tree (the immutable-handle contract). The
# chess_mcp wrapper caches the returned clone under a fresh id via store_repertoire.
# ---------------------------------------------------------------------------


def clone_game(game: chess.pgn.Game) -> chess.pgn.Game:
    """Independent deep copy of a parsed tree (variation order, NAGs, comments intact)."""
    return copy.deepcopy(game)


def _prune(
    game: chess.pgn.Game, path: list[str]
) -> tuple[chess.pgn.Game | None, str | None]:
    """Drop the node at `path` and its subtree from a clone. The root cannot be pruned."""
    if not path:
        return None, "invalid_edit"  # empty path = the root; nothing to detach it from
    clone = clone_game(game)
    node = resolve_path(clone, path)
    if node is None or node.parent is None:
        return None, "variation_not_found"
    node.parent.variations.remove(node)
    return clone, None


def _add(
    game: chess.pgn.Game, path: list[str], add_moves: list[str]
) -> tuple[chess.pgn.Game | None, str | None]:
    """Graft SAN plies under the node at `path` in a clone, merging into an existing child when
    the move already exists (no duplicate siblings — mirrors _merge_into)."""
    if not add_moves:
        return None, "invalid_edit"  # add with nothing to add
    clone = clone_game(game)
    node = resolve_path(clone, path)
    if node is None:
        return None, "variation_not_found"
    for san in add_moves:
        try:
            move = node.board().parse_san(san)
        except ValueError:
            return None, "invalid_line"  # illegal/unparseable SAN at this ply
        child = next((c for c in node.variations if c.move == move), None)
        node = child if child is not None else node.add_variation(move)
    return clone, None


def _reorder(
    game: chess.pgn.Game, path: list[str], promote_move: str | None
) -> tuple[chess.pgn.Game | None, str | None]:
    """Promote the child playing `promote_move` to the mainline (variations[0]) at `path`."""
    if not promote_move:
        return None, "invalid_edit"  # reorder needs a child to promote
    clone = clone_game(game)
    node = resolve_path(clone, path)
    if node is None:
        return None, "variation_not_found"
    try:
        move = node.board().parse_san(promote_move)
    except ValueError:
        return None, "variation_not_found"  # not legal here → cannot be a child move
    child = next((c for c in node.variations if c.move == move), None)
    if child is None:
        return None, "variation_not_found"
    node.promote_to_main(child)
    return clone, None


def apply_repertoire_edit(
    game: chess.pgn.Game,
    action: str,
    path: list[str],
    add_moves: list[str] | None,
    promote_move: str | None,
) -> tuple[chess.pgn.Game | None, str | None]:
    """Dispatch a clone-on-write edit. Returns (new_game, None) on success, else
    (None, error_code) — one of variation_not_found / invalid_line / invalid_edit."""
    if action == "prune":
        return _prune(game, path)
    if action == "add":
        return _add(game, path, add_moves or [])
    if action == "reorder":
        return _reorder(game, path, promote_move)
    return (
        None,
        "invalid_edit",
    )  # defensive — Literal guards the action at the schema layer


def export_pgn(game: chess.pgn.Game) -> str:
    """Serialize the tree to a multi-variation PGN string (E2a: one [Event], all variations,
    NAGs + comments). Round-trips through load_repertoire (merge is idempotent)."""
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    return game.accept(exporter)


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

    Transposition-aware: a player-to-move leaf whose position is also reached elsewhere as an
    internal node that DOES continue is already covered by that move order — it is not a real
    hole, so it is excluded from dangling and lands in frontier_count (= leaves - dangling)
    instead (Issue #15; mirrors the gap tool's #3 dedup).
    """
    leaves = list(walk_leaves(rep.game))
    continued_keys = continued_position_key_set(rep.game)
    dangling = [
        leaf
        for leaf in leaves
        if leaf.board().turn == rep.color
        and _position_key(leaf.board()) not in continued_keys
    ]
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


def _cluster_label(leaf, structure_class: str, theme_tags: set, path: list[str]) -> str:
    """The opening-SYSTEM a leaf belongs to — the congruence cluster key (REPERTOIRE_DESIGN.md
    section 10). Move-order-robust so a system reached by several first moves clusters as ONE,
    and granular enough that distinct systems under one first move don't dilute. NOT keyed on
    structure_class: that would make every cluster structurally homogeneous and disable the
    structure_outlier check — the per-system deviation we want surfaced would instead be hidden
    in its own cluster (Decision C1).

    Chain (prefer structural/named convergence over literal move order, Decision C3):
      1. opening name family from openings.deepest_to_node (EPD-keyed → transpositions converge
         for free), truncated at the first colon to FAMILY grain (Decision C2 — validated on the
         two real repertoires: family-level keeps White's English one cohesive 17-leaf cluster
         and gives Black ~8 well-sized systems with a real grain; finer variation-level grain
         re-shatters both into thin 1–2-leaf groups that surface nothing);
      2. structure_class, when the leaf is named-structure but not in the ECO table;
      3. the leaf's primary bool theme (BOOL_THEMES priority), for unknown-structure systems;
      4. the opponent's first move — the shipped key, last resort.
    Fallback labels are namespaced ("structure:"/"theme:"/"first-move:") so they never collide
    with a bare opening name.
    """
    op = openings.deepest_to_node(leaf)
    if op:
        return op["name"].split(":")[0].strip()
    if structure_class != "unknown":
        return f"structure:{structure_class}"
    for theme in BOOL_THEMES:  # BOOL_THEMES order = priority
        if theme in theme_tags:
            return f"theme:{theme}"
    return f"first-move:{path[0]}" if path else "first-move:"


def analyze_congruence(
    rep: _Repertoire,
    min_severity: str,
    limit: int,
    acknowledged_weaknesses: list | None = None,
    exclude_paths: list | None = None,
) -> dict:
    """Flag thematic inconsistencies across the repertoire's leaves.

    acknowledged_weaknesses: list of variation paths (each a list of SAN strings) whose
    weakness_inconsistency flags should be downgraded to severity "low" with
    acknowledged:true — for known positional systems the user accepts intentionally.

    exclude_paths: variation paths (e.g. from classify_illustrative_lines) whose subtree is
    dropped from analysis entirely — illustrative "wrong-answer" lines are not real lines, so
    they should not be judged for congruence at all.
    """
    ack_set: set[tuple] = {tuple(p) for p in (acknowledged_weaknesses or [])}
    excl: list = [list(p) for p in (exclude_paths or [])]

    # Collect structural + pawn data for every leaf (skipping excluded illustrative lines)
    data = []
    for leaf in walk_leaves(rep.game):
        path = san_path(leaf)
        if excl and path_excluded(path, excl):
            continue
        board = leaf.board()
        t = structure.themes(board, rep.color)
        sc = structure.classify_structure(board)["structure_class"]
        theme_tags = {k for k in BOOL_THEMES if t[k]}
        data.append(
            {
                "path": path,
                "_pos_key": _position_key(board),
                "structure": sc,
                "cluster": _cluster_label(leaf, sc, theme_tags, path),
                "isolated": structure.get_isolated_pawns(board, rep.color),
                "doubled": structure.get_doubled_pawns(board, rep.color),
                "center": structure.center_state(board),
                "theme_tags": theme_tags,
            }
        )
    n = len(data)

    # Transposition stubs: a leaf whose position the tree ALSO reaches as an interior
    # node that continues — the stub is covered structurally via that longer move order.
    # Keyed on continued (interior) positions only, not any reached-twice position: two
    # theme-lacking leaves converging on the same position are both genuine outliers,
    # not stubs (review-findings #8). Computed once over the whole tree and shared by
    # every opening group (Issue #9).
    transposition_keys = continued_position_key_set(rep.game)

    def _checks_for(group: list[dict]) -> list[dict]:
        """Run the three congruence checks within ONE opening's leaves (Issue #14).

        A repertoire spanning several openings (one answer per opponent first move) has no
        single structural grain; judging a Caro IQP line against Nimzo leaves is noise. So
        each leaf is compared only to its own opening's siblings. `group` is never empty —
        groups exist only for leaves that produced data."""
        gn = len(group)
        found: list[dict] = []

        # 1. structure_outlier — a line veering off the opening's dominant structure.
        known = [d for d in group if d["structure"] != "unknown"]
        known_share = len(known) / gn

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
        else:
            # 1b. Theme-based fallback: most leaves are unknown — use dominant bool theme
            # as a structural proxy. A leaf that lacks the dominant theme is an outlier even
            # when no named structure can be assigned (e.g. hypermodern English repertoires
            # where fianchetto_white fires on most leaves but structure_class is unknown).
            theme_counts = Counter(theme for d in group for theme in d["theme_tags"])
            dominant_theme_candidates = [
                (t, c) for t, c in theme_counts.items() if c / gn >= _THEME_DOMINANCE
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
        if not weak or len(weak) >= gn * 0.5:
            pass  # Skip: no weaknesses, or weaknesses are the majority → no grain to violate
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
        if locked / gn < 0.25 or opened / gn < 0.25:
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

    # Group leaves by opening SYSTEM (move-order-robust cluster key, REPERTOIRE_DESIGN.md
    # section 10) and judge each leaf only against its own system's siblings. A transposing
    # system reached via several first moves clusters as ONE (fixes the multi-first-move
    # shatter that washed Black repertoires out); distinct systems under one first move stay
    # separate. Each flag carries its cluster label so the user sees which system it's relative
    # to. A single-system repertoire is one group → same behaviour as before.
    groups: dict[str, list[dict]] = {}
    for d in data:
        groups.setdefault(d["cluster"], []).append(d)
    incongruencies: list[dict] = []
    for label, group in groups.items():
        for flag in _checks_for(group):
            flag["cluster"] = label
            incongruencies.append(flag)

    # Filter and sort by severity; cap to limit
    floor = _SEVERITY_RANK[min_severity]
    filtered = [x for x in incongruencies if _SEVERITY_RANK[x["severity"]] >= floor]
    filtered.sort(key=lambda x: -_SEVERITY_RANK[x["severity"]])

    # Acknowledged items are downgraded (severity: low, acknowledged: true) BEFORE the
    # min_severity filter, so at the default "medium" floor they drop out entirely; pass
    # min_severity="low" to see them. The headline counts exclude them either way, so
    # callers see how many real (unacknowledged) issues remain (Issue #10).
    acknowledged_count = sum(1 for x in filtered if x.get("acknowledged"))
    unacknowledged = [x for x in filtered if not x.get("acknowledged")]
    by_type = Counter(x["type"] for x in unacknowledged)
    by_type_ack = Counter(x["type"] for x in filtered if x.get("acknowledged"))
    # Cluster partition (label → leaf count), largest first — shows how the repertoire split
    # into opening systems, so the user can read each flag relative to its system's grain.
    clusters = dict(
        sorted(
            ((label, len(g)) for label, g in groups.items()),
            key=lambda kv: (-kv[1], kv[0]),
        )
    )
    return {
        "total_flagged": len(unacknowledged),
        "acknowledged_count": acknowledged_count,
        "leaves_analyzed": n,
        "clusters": clusters,
        "by_type": dict(by_type),
        "by_type_acknowledged": dict(by_type_ack),
        "incongruencies": filtered[:limit],
    }


# ---------------------------------------------------------------------------
# Replacement-pivot resolution (suggest_replacement_line). Pure tree analysis;
# the engine pass on the pivot position stays in chess_mcp.py.
# ---------------------------------------------------------------------------


def _user_move_nodes(node, color: chess.Color) -> list:
    """The nodes along root→`node` whose move was played by `color`, root-first."""
    chain = []
    while node.parent is not None:
        chain.append(node)
        node = node.parent
    chain.reverse()
    return [c for c in chain if c.parent.board().turn == color]


def replacement_pivot(rep: _Repertoire, node) -> tuple:
    """The user move suggest_replacement_line should replace in `node`'s line, plus the
    repertoire's dominant bool themes (reused by the caller's PV-theme scoring).

    Pivot, in order:
      1. the earliest user move not played in any dominant-theme line — the structural
         divergence point (Issue #7);
      2. else the first user move after which the player carries a doubled/isolated pawn —
         the move that incurs the weakness, which a replacement can avoid; the terminal
         move cannot undo a weakness incurred earlier (Issue #16);
      3. else the last user move in the line.

    Dominant theme = bool theme on >= _THEME_DOMINANCE of leaves — the same threshold
    analyze_congruence uses, so a line treated as divergent here is one congruence would
    also flag (a lower threshold produced replacements for lines congruence considered fine).

    Returns (pivot_node, dominant_themes); pivot_node is None when the line contains no
    user move. A returned pivot is always a user-move node (parent has `rep.color` to move).
    """
    leaves = list(walk_leaves(rep.game))
    tags_by_leaf = [
        {t for t in BOOL_THEMES if structure.themes(leaf.board(), rep.color)[t]}
        for leaf in leaves
    ]
    theme_counts = Counter(t for tags in tags_by_leaf for t in tags)
    dominant_themes = {
        t for t, c in theme_counts.items() if c / len(leaves) >= _THEME_DOMINANCE
    }

    # (position_key, move_uci) pairs the user plays in any dominant-theme leaf's line.
    dominant_pairs: set[tuple[str, str]] = set()
    for leaf, tags in zip(leaves, tags_by_leaf):
        if not (dominant_themes & tags):
            continue
        n = leaf
        while n.parent is not None:
            b = n.parent.board()
            if b.turn == rep.color:
                dominant_pairs.add((_position_key(b), n.move.uci()))
            n = n.parent

    user_moves = _user_move_nodes(node, rep.color)
    if dominant_pairs:
        for child in user_moves:
            key = (_position_key(child.parent.board()), child.move.uci())
            if key not in dominant_pairs:
                return child, dominant_themes
    for child in user_moves:
        after = child.board()
        if structure.get_doubled_pawns(
            after, rep.color
        ) or structure.get_isolated_pawns(after, rep.color):
            return child, dominant_themes
    return (user_moves[-1] if user_moves else None), dominant_themes
