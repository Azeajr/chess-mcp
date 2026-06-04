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
    wnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bnames = {chess.square_name(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}
    wfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.WHITE)}
    bfiles = {chess.square_file(sq) for sq in board.pieces(chess.PAWN, chess.BLACK)}

    candidates: list[tuple[str, float]] = []

    # IQP / Carlsbad / Maroczy — scored by the shared scorers above (one source of truth).
    for color in (chess.WHITE, chess.BLACK):  # either side can carry an IQP
        conf = _iqp_confidence(board, color)
        if conf > 0:
            candidates.append(("IQP", conf))
    for name, conf in (
        ("Carlsbad", _carlsbad_confidence(board)),
        ("Maroczy", _maroczy_confidence(board)),
    ):
        if conf > 0:
            candidates.append((name, conf))

    # French Advance: e5/d4 vs e6/d5
    if {"e5", "d4"} <= wnames and {"e6", "d5"} <= bnames:
        candidates.append(("French", 0.85))
    if {"e4", "d5"} <= bnames and {"e3", "d4"} <= wnames:
        candidates.append(("French", 0.6))

    # Stonewall: d5/e6/f5 (Black) or d4/e3/f4 (White)
    if {"d5", "e6", "f5"} <= bnames:
        candidates.append(("Stonewall", 0.85))
    if {"d4", "e3", "f4"} <= wnames:
        candidates.append(("Stonewall", 0.85))

    # King's Indian: c4/d5/e4 (White) vs d6/e5/g6 (Black)
    if {"c4", "d5", "e4"} <= wnames and {"d6", "e5", "g6"} <= bnames:
        candidates.append(("King's Indian", 0.85))
    if {"c5", "d4", "e5"} <= bnames and {"d3", "e4", "g3"} <= wnames:
        candidates.append(("King's Indian", 0.6))

    # Benoni: d5/e4 (White) vs c5/d6 (Black) + half-open e for Black
    if {"d5", "e4"} <= wnames and {"c5", "d6"} <= bnames and 4 not in bfiles:
        candidates.append(("Benoni", 0.85))
    if {"d4", "e5"} <= bnames and {"c4", "d3"} <= wnames and 4 not in wfiles:
        candidates.append(("Benoni", 0.6))

    # Closed Sicilian (Grand Prix skeleton): White e4/d3/f4 small center vs Black c5/d6.
    # Brittle under static matching (D2) → lower confidence; the d3 (not d4) + f4 trio
    # separates it from open-Sicilian and KIA-vs-Sicilian reads. No mirrored Black variant.
    if {"e4", "d3", "f4"} <= wnames and {"c5", "d6"} <= bnames:
        candidates.append(("Closed Sicilian", 0.7))

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
    }
