"""Static, engine-free pawn-structure analysis.

Bridges engine centipawns and human structural themes. Everything here is pure
`python-chess` bitboard work — no Stockfish, no I/O — so it is fast and unit-testable
without the engine. Consumed by the repertoire tools in `chess_mcp.py`.

See REPERTOIRE_DESIGN.md section 6. classify_structure deliberately ships a NARROW set
(IQP, Carlsbad, Maroczy) with a confidence score and an explicit `unknown` fallback: a
false structure label misleads an LLM more than "unknown" does (Decision D2).
"""

import chess

FILE_NAMES = "abcdefgh"

# ---------------------------------------------------------------------------
# Primitives — each takes (board, color) and returns square names (sorted).
# ---------------------------------------------------------------------------


def get_doubled_pawns(board: chess.Board, color: chess.Color) -> list[str]:
    """Pawns sharing a file with at least one friendly pawn."""
    pawns = board.pieces(chess.PAWN, color)
    out: list[int] = []
    for f in range(8):
        file_pawns = [sq for sq in pawns if chess.square_file(sq) == f]
        if len(file_pawns) >= 2:
            out.extend(file_pawns)
    return sorted(chess.square_name(sq) for sq in out)


def get_isolated_pawns(board: chess.Board, color: chess.Color) -> list[str]:
    """Pawns with no friendly pawn on either adjacent file."""
    pawns = board.pieces(chess.PAWN, color)
    occupied_files = {chess.square_file(sq) for sq in pawns}
    out = [
        sq
        for sq in pawns
        if (chess.square_file(sq) - 1) not in occupied_files
        and (chess.square_file(sq) + 1) not in occupied_files
    ]
    return sorted(chess.square_name(sq) for sq in out)


def get_passed_pawns(board: chess.Board, color: chess.Color) -> list[str]:
    """Pawns with no enemy pawn on the same or adjacent file ahead of them."""
    pawns = board.pieces(chess.PAWN, color)
    enemy = board.pieces(chess.PAWN, not color)
    out: list[int] = []
    for sq in pawns:
        f, r = chess.square_file(sq), chess.square_rank(sq)
        blocked = False
        for esq in enemy:
            ef, er = chess.square_file(esq), chess.square_rank(esq)
            if abs(ef - f) > 1:
                continue
            ahead = er > r if color == chess.WHITE else er < r
            if ahead:
                blocked = True
                break
        if not blocked:
            out.append(sq)
    return sorted(chess.square_name(sq) for sq in out)


def get_pawn_chains(board: chess.Board, color: chess.Color) -> list[list[str]]:
    """Maximal groups of friendly pawns connected by diagonal defense.

    Two friendly pawns are linked when one defends the other (a pawn defends the two
    forward diagonal squares). Returns only chains of length >= 2, each sorted, the
    list of chains sorted for determinism.
    """
    pawns = list(board.pieces(chess.PAWN, color))
    pawn_set = set(pawns)
    forward = 1 if color == chess.WHITE else -1

    parent = {sq: sq for sq in pawns}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        parent[find(a)] = find(b)

    for sq in pawns:
        f, r = chess.square_file(sq), chess.square_rank(sq)
        nr = r + forward
        if 0 <= nr <= 7:
            for nf in (f - 1, f + 1):
                if 0 <= nf <= 7:
                    target = chess.square(nf, nr)
                    if target in pawn_set:
                        union(sq, target)

    groups: dict[int, list[int]] = {}
    for sq in pawns:
        groups.setdefault(find(sq), []).append(sq)

    chains = [
        sorted(chess.square_name(s) for s in g) for g in groups.values() if len(g) >= 2
    ]
    return sorted(chains)


def get_half_open_files(board: chess.Board, color: chess.Color) -> list[str]:
    """Files with no friendly pawn but at least one enemy pawn (half-open for `color`)."""
    own_files = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, color)}
    enemy_files = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, not color)}
    return [FILE_NAMES[f] for f in range(8) if f not in own_files and f in enemy_files]


def get_open_files(board: chess.Board) -> list[str]:
    """Files with no pawn of either color."""
    pawn_files = {
        chess.square_file(sq)
        for sq in board.pieces(chess.PAWN, chess.WHITE)
        | board.pieces(chess.PAWN, chess.BLACK)
    }
    return [FILE_NAMES[f] for f in range(8) if f not in pawn_files]


# ---------------------------------------------------------------------------
# Theme tags (A) — always-computed descriptors, never "unknown".
# Derived from pawns + cheap piece checks. Descriptive, not name-guesses, so they
# carry signal even when classify_structure returns unknown (STRUCTURE_CLASSIFIER_DESIGN.md
# §2A). Heuristic thresholds are deliberately conservative (D-STRUCT-2): bias to
# false-negative so a tag, when present, is trustworthy.
# ---------------------------------------------------------------------------

_QUEENSIDE = frozenset({0, 1, 2, 3})  # files a–d
_QS_FILE_NAMES = frozenset("abcd")
_KS_FILE_NAMES = frozenset("efgh")


def _wing_pawn_counts(board: chess.Board, color: chess.Color) -> tuple[int, int]:
    """(queenside, kingside) pawn counts for `color`. Queenside = files a–d."""
    qs = ks = 0
    for sq in board.pieces(chess.PAWN, color):
        if chess.square_file(sq) in _QUEENSIDE:
            qs += 1
        else:
            ks += 1
    return qs, ks


def _wing_majority(board: chess.Board, color: chess.Color) -> str | None:
    """Which single wing `color` holds a strict pawn majority on, else None.

    Majority on both wings (or neither) → None: only a distinctive single-wing
    majority is reported (the competing-majorities / 3-3 vs 4-2 signal)."""
    own_qs, own_ks = _wing_pawn_counts(board, color)
    opp_qs, opp_ks = _wing_pawn_counts(board, not color)
    qs_maj = own_qs > opp_qs
    ks_maj = own_ks > opp_ks
    if qs_maj and not ks_maj:
        return "queenside"
    if ks_maj and not qs_maj:
        return "kingside"
    return None


def _minority_attack(board: chess.Board, color: chess.Color) -> bool:
    """`color` has a pawn minority on a wing AND a half-open file there to lever
    the opponent's majority (the Carlsbad minority-attack motif)."""
    own_qs, own_ks = _wing_pawn_counts(board, color)
    opp_qs, opp_ks = _wing_pawn_counts(board, not color)
    half = set(get_half_open_files(board, color))
    if own_qs < opp_qs and (half & _QS_FILE_NAMES):
        return True
    if own_ks < opp_ks and (half & _KS_FILE_NAMES):
        return True
    return False


def _color_complex(board: chess.Board, color: chess.Color) -> str | None:
    """The weak square-complex for `color`: the color opposite where its pawns
    cluster. Conservative — needs a clear skew (diff >= 3) to report."""
    light = dark = 0
    for sq in board.pieces(chess.PAWN, color):
        if (chess.square_file(sq) + chess.square_rank(sq)) % 2 == 0:
            dark += 1  # a1 (file 0 + rank 0) is dark
        else:
            light += 1
    if dark - light >= 3:
        return "light"  # pawns on dark squares → light squares are weak
    if light - dark >= 3:
        return "dark"
    return None


def themes(board: chess.Board, color: chess.Color) -> dict:
    """Always-on structural theme tags (A). Flat (one level) to stay within the
    MCP nesting budget. `color_complex` is from `color`'s POV; the rest are absolute."""
    wbishops = board.pieces(chess.BISHOP, chess.WHITE)
    bbishops = board.pieces(chess.BISHOP, chess.BLACK)
    w_center = sum(
        1 for sq in board.pieces(chess.PAWN, chess.WHITE) if chess.square_file(sq) in (3, 4)
    )
    b_center = sum(
        1 for sq in board.pieces(chess.PAWN, chess.BLACK) if chess.square_file(sq) in (3, 4)
    )
    return {
        "fianchetto_white": chess.G2 in wbishops or chess.B2 in wbishops,
        "fianchetto_black": chess.G7 in bbishops or chess.B7 in bbishops,
        # space = own pawns on advancing ranks (White 4–6, Black 3–5).
        "space_white": sum(
            1 for sq in board.pieces(chess.PAWN, chess.WHITE) if 3 <= chess.square_rank(sq) <= 5
        ),
        "space_black": sum(
            1 for sq in board.pieces(chess.PAWN, chess.BLACK) if 2 <= chess.square_rank(sq) <= 4
        ),
        "wing_majority_white": _wing_majority(board, chess.WHITE),
        "wing_majority_black": _wing_majority(board, chess.BLACK),
        "minority_attack_white": _minority_attack(board, chess.WHITE),
        "minority_attack_black": _minority_attack(board, chess.BLACK),
        # one side commits the centre while the other has vacated it.
        "flank_vs_center": (w_center >= 2 and b_center == 0)
        or (b_center >= 2 and w_center == 0),
        "color_complex": _color_complex(board, color),
    }


# ---------------------------------------------------------------------------
# Center tension — locked / tense / open / semi-open.
# ---------------------------------------------------------------------------


def center_state(board: chess.Board) -> str:
    """Classify central pawn tension on the d/e files.

    - "tense": a central pawn can capture an enemy pawn (contact, unresolved).
    - "locked": opposing pawns face each other on a central file, blocked.
    - "open": one side has no d/e pawn.
    - "semi-open": central pawns present but not in contact or locked.
    """
    white = board.pieces(chess.PAWN, chess.WHITE)
    black = board.pieces(chess.PAWN, chess.BLACK)
    central = (3, 4)  # d, e

    w_central = [sq for sq in white if chess.square_file(sq) in central]
    b_central = [sq for sq in black if chess.square_file(sq) in central]

    for (
        sq
    ) in w_central:  # a White central pawn attacks a Black pawn (forward diagonals)
        f, r = chess.square_file(sq), chess.square_rank(sq)
        if r + 1 <= 7:
            for nf in (f - 1, f + 1):
                if 0 <= nf <= 7 and chess.square(nf, r + 1) in black:
                    return "tense"
    for sq in b_central:  # symmetric: a Black central pawn attacks a White pawn
        f, r = chess.square_file(sq), chess.square_rank(sq)
        if r - 1 >= 0:
            for nf in (f - 1, f + 1):
                if 0 <= nf <= 7 and chess.square(nf, r - 1) in white:
                    return "tense"

    for f in central:
        w_ranks = [chess.square_rank(sq) for sq in white if chess.square_file(sq) == f]
        b_ranks = [chess.square_rank(sq) for sq in black if chess.square_file(sq) == f]
        if w_ranks and b_ranks and (min(b_ranks) - max(w_ranks)) == 1:
            return "locked"

    if not w_central or not b_central:
        return "open"
    return "semi-open"


# ---------------------------------------------------------------------------
# Macro classifier — narrow set + confidence, never forces a label (D2).
# The per-structure scorers below are the SINGLE source of truth: classify_structure
# ranks their outputs, and they double as the tested private API. No pattern logic is
# written twice (each returns a confidence in [0, 1]; 0.0 means "not this structure").
# ---------------------------------------------------------------------------


def _iqp_confidence(board: chess.Board, color: chess.Color) -> float:
    """Isolated Queen's Pawn confidence for `color`: a lone d-pawn with no c/e pawn while
    the opponent has no d-pawn, scored highest on the classic central square."""
    d_pawns = [
        sq for sq in board.pieces(chess.PAWN, color) if chess.square_file(sq) == 3
    ]
    if len(d_pawns) != 1:
        return 0.0
    files = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, color)}
    if 2 in files or 4 in files:  # a c- or e-pawn means the d-pawn is not isolated
        return 0.0
    if any(chess.square_file(sq) == 3 for sq in board.pieces(chess.PAWN, not color)):
        return 0.0  # opponent still has a d-pawn → not an isolani
    r = chess.square_rank(d_pawns[0])
    if color == chess.WHITE:
        return 0.9 if r == 3 else 0.6 if r in (4, 5) else 0.0
    return 0.9 if r == 4 else 0.6 if r in (2, 3) else 0.0


def _carlsbad_confidence(board: chess.Board) -> float:
    """Carlsbad confidence: d4/d5 skeleton with one side half-open on the c-file, no e-pawn."""
    wnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    wfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    if "d4" not in wnames or "d5" not in bnames:
        return 0.0
    if 2 not in wfiles and 2 in bfiles and 4 not in bfiles:
        return 0.85  # White half-open c; Black keeps c, no e
    if 2 in wfiles and 2 not in bfiles and 4 not in wfiles:
        return 0.7  # Black half-open c; White keeps c, no e
    return 0.0


def _maroczy_confidence(board: chess.Board) -> float:
    """Maroczy bind confidence: a c+e pawn duo with no d-pawn (White c4/e4 or Black c5/e5)."""
    wnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    wfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    if "c4" in wnames and "e4" in wnames and 3 not in wfiles:
        return 0.85
    if "c5" in bnames and "e5" in bnames and 3 not in bfiles:
        return 0.7
    return 0.0


def _graded(core_ok: bool, bonus_present: int, *, base: float, cap: float, step: float = 0.05) -> float:
    """Core+bonus confidence (B). `core_ok` is the hard gate — False → 0.0 (D2: no
    core, no label). Each present bonus square lifts confidence from `base` toward
    `cap`, so a position missing a peripheral square still classifies (just lower),
    instead of the all-or-nothing exact-match brittleness it replaces."""
    if not core_ok:
        return 0.0
    return round(min(cap, base + step * bonus_present), 2)


def _french_confidence(board: chess.Board) -> float:
    """French/Advance chain: d4+e5 vs d5+e6 (reversed-colour variant scored lower)."""
    wnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    if {"d4", "e5"} <= wnames and {"d5", "e6"} <= bnames:
        return 0.85
    if {"d4", "e3"} <= wnames and {"d5", "e4"} <= bnames:
        return 0.6
    return 0.0


def _stonewall_confidence(board: chess.Board) -> float:
    """Stonewall wall: White d4/e3/f4 or Black d5/e6/f5."""
    wnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    if {"d4", "e3", "f4"} <= wnames or {"d5", "e6", "f5"} <= bnames:
        return 0.85
    return 0.0


def _kid_confidence(board: chess.Board) -> float:
    """King's Indian chain. Core d5+e4 vs e5+d6 (the locked centre); the c4 pawn and
    the g6 fianchetto are bonus, so a KID missing one still classifies (B)."""
    wnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    if {"d5", "e4"} <= wnames and {"e5", "d6"} <= bnames:
        bonus = ("c4" in wnames) + ("g6" in bnames)
        return _graded(True, bonus, base=0.7, cap=0.85, step=0.075)
    if {"d4", "e5"} <= bnames and {"e4", "d3"} <= wnames:  # reversed colours
        bonus = ("c5" in bnames) + ("g3" in wnames)
        return _graded(True, bonus, base=0.45, cap=0.6, step=0.075)
    return 0.0


def _benoni_confidence(board: chess.Board) -> float:
    """Asymmetric Benoni: d5+e4 vs c5+d6 with a half-open e-file for the defender."""
    wnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    wfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    if {"d5", "e4"} <= wnames and {"c5", "d6"} <= bnames and 4 not in bfiles:
        return 0.85
    if {"d4", "e5"} <= bnames and {"c4", "d3"} <= wnames and 4 not in wfiles:
        return 0.6
    return 0.0


def _closed_sicilian_confidence(board: chess.Board, color: chess.Color) -> float:
    """Closed Sicilian / Grand Prix wall, scored for `color` (bidirectional — the
    Black side is the reversed-English Grand Prix). Core e4+f4 vs opp c5; d3 and the
    opponent's d6 are bonus."""
    own = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, color)}
    opp = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, not color)}
    if color == chess.WHITE:
        core_ok = {"e4", "f4"} <= own and "c5" in opp
        bonus = ("d3" in own) + ("d6" in opp)
        return _graded(core_ok, bonus, base=0.6, cap=0.7)
    core_ok = {"e5", "f5"} <= own and "c4" in opp  # mirror for Black
    bonus = ("d6" in own) + ("d3" in opp)
    return _graded(core_ok, bonus, base=0.5, cap=0.65)


def classify_structure(board: chess.Board) -> dict:
    """Pattern-match the board to a named pawn structure.

    Returns {structure_class, confidence}. structure_class is one of
    IQP / Carlsbad / Maroczy / French / Stonewall / King's Indian / Benoni /
    Closed Sicilian / unknown.
    Never forces a label — a weak or absent match yields {"unknown", 0.0}.
    Highest-confidence candidate wins.

    Patterns:
    - IQP: isolated d-pawn (no c/e pawn) with d-file half-open for opponent, advanced square.
    - Carlsbad: d4/d5 skeleton + one side half-open on c, the other with c-pawn, no e-pawn.
    - Maroczy: c4 + e4 binding structure (no d-pawn).
    - French Advance: e5/d4 (White) vs e6/d5 (Black), locked pawns.
    - Stonewall: d5/e6/f5 pawn wall (Black side) or d4/e3/f4 (White).
    - King's Indian: c4/d5/e4 (White) vs d6/e5/g6 (Black), locked center.
    - Benoni: d5/e4 (White) vs c5/d6 (Black) + half-open e-file for Black.
    - Closed Sicilian: e4/d3/f4 (White) vs c5/d6 (Black), the Grand Prix skeleton.
    """
    candidates: list[tuple[str, float]] = []

    # Bidirectional scorers — either side can carry the structure.
    for color in (chess.WHITE, chess.BLACK):
        for name, conf in (
            ("IQP", _iqp_confidence(board, color)),
            ("Closed Sicilian", _closed_sicilian_confidence(board, color)),
        ):
            if conf > 0:
                candidates.append((name, conf))

    # Single-orientation scorers (each handles its own colour logic internally).
    for name, conf in (
        ("Carlsbad", _carlsbad_confidence(board)),
        ("Maroczy", _maroczy_confidence(board)),
        ("French", _french_confidence(board)),
        ("Stonewall", _stonewall_confidence(board)),
        ("King's Indian", _kid_confidence(board)),
        ("Benoni", _benoni_confidence(board)),
    ):
        if conf > 0:
            candidates.append((name, conf))

    if not candidates:
        return {"structure_class": "unknown", "confidence": 0.0}
    structure_class, confidence = max(candidates, key=lambda x: x[1])
    return {"structure_class": structure_class, "confidence": round(confidence, 2)}


def position_profile(board: chess.Board, color: chess.Color) -> dict:
    """Full static structural profile of one position, from `color`'s POV.

    Shape consumed by get_structural_profile (single-node form). Nesting kept <= 2
    levels per MCP_DESIGN.md.
    """
    classification = classify_structure(board)
    return {
        "fen": board.fen(),
        "structure_class": classification["structure_class"],
        "confidence": classification["confidence"],
        "center": center_state(board),
        "primitives": {
            "doubled": get_doubled_pawns(board, color),
            "isolated": get_isolated_pawns(board, color),
            "passed": get_passed_pawns(board, color),
            "chains": get_pawn_chains(board, color),
        },
        "half_open_files": get_half_open_files(board, color),
        "open_files": get_open_files(board),
        "themes": themes(board, color),
    }
