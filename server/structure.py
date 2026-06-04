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
        for sq in board.pieces(chess.PAWN, chess.WHITE) | board.pieces(chess.PAWN, chess.BLACK)
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

    for sq in w_central:  # a White central pawn attacks a Black pawn (forward diagonals)
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
# ---------------------------------------------------------------------------


def _names(board: chess.Board, color: chess.Color) -> set[str]:
    return {chess.square_name(sq) for sq in board.pieces(chess.PAWN, color)}


def _files(board: chess.Board, color: chess.Color) -> set[int]:
    return {chess.square_file(sq) for sq in board.pieces(chess.PAWN, color)}


def _iqp_confidence(board: chess.Board, color: chess.Color) -> float:
    """Isolated Queen's Pawn: a lone, isolated central d-pawn with the d-file
    half-open for the opponent."""
    pawns = board.pieces(chess.PAWN, color)
    d_pawns = [sq for sq in pawns if chess.square_file(sq) == 3]
    if len(d_pawns) != 1:
        return 0.0
    own_files = _files(board, color)
    if 2 in own_files or 4 in own_files:  # has a c- or e-pawn → not isolated
        return 0.0
    if any(chess.square_file(sq) == 3 for sq in board.pieces(chess.PAWN, not color)):
        return 0.0  # opponent still has a d-pawn → not a true central isolani
    # An IQP is an ADVANCED central isolani, not a home d2/d7 pawn that happens to be
    # isolated. Classic squares (d4/d5) score highest; d3/d6 a notch lower; home-rank → 0.
    r = chess.square_rank(d_pawns[0])
    if color == chess.WHITE:
        return 0.9 if r == 3 else 0.6 if r in (4, 5) else 0.0
    return 0.9 if r == 4 else 0.6 if r in (2, 3) else 0.0


def _carlsbad_confidence(board: chess.Board) -> float:
    """Carlsbad (Exchange-QGD skeleton): one side has a d-pawn and a half-open c-file
    (no c-pawn); the other has the opposing d-pawn, keeps its c-pawn, and has no e-pawn
    — the classic minority-attack structure."""
    wnames, bnames = _names(board, chess.WHITE), _names(board, chess.BLACK)
    wfiles, bfiles = _files(board, chess.WHITE), _files(board, chess.BLACK)
    # White holds the half-open c-file (minority attacker), Black has c-pawn, no e-pawn.
    if "d4" in wnames and 2 not in wfiles and "d5" in bnames and 2 in bfiles and 4 not in bfiles:
        return 0.85
    # Mirrored: Black holds the half-open c-file.
    if "d5" in bnames and 2 not in bfiles and "d4" in wnames and 2 in wfiles and 4 not in wfiles:
        return 0.7
    return 0.0


def _maroczy_confidence(board: chess.Board) -> float:
    """Maroczy Bind: White pawns on c4 and e4 binding d5, with no White d-pawn."""
    white = _names(board, chess.WHITE)
    if "c4" in white and "e4" in white and 3 not in _files(board, chess.WHITE):
        return 0.85
    black = _names(board, chess.BLACK)
    if "c5" in black and "e5" in black and 3 not in _files(board, chess.BLACK):
        return 0.7  # mirrored (Black binds)
    return 0.0


def _french_confidence(board: chess.Board) -> float:
    """French Advance chain: White e5 + d4 locked against Black e6 + d5."""
    w, b = _names(board, chess.WHITE), _names(board, chess.BLACK)
    if {"e5", "d4"} <= w and {"e6", "d5"} <= b:
        return 0.85
    if {"e4", "d5"} <= b and {"e3", "d4"} <= w:  # mirrored (Black has advanced e-pawn)
        return 0.6
    return 0.0


def _stonewall_confidence(board: chess.Board) -> float:
    """Stonewall: the d5/e6/f5 pawn wall (Black) or d4/e3/f4 (White)."""
    if {"d5", "e6", "f5"} <= _names(board, chess.BLACK):
        return 0.85
    if {"d4", "e3", "f4"} <= _names(board, chess.WHITE):
        return 0.85
    return 0.0


def _kings_indian_confidence(board: chess.Board) -> float:
    """King's Indian locked center: White c4/d5/e4 against Black d6/e5/g6."""
    w, b = _names(board, chess.WHITE), _names(board, chess.BLACK)
    if {"c4", "d5", "e4"} <= w and {"d6", "e5", "g6"} <= b:
        return 0.85
    if {"c5", "d4", "e5"} <= b and {"d3", "e4", "g3"} <= w:  # mirrored
        return 0.6
    return 0.0


def _benoni_confidence(board: chess.Board) -> float:
    """Modern Benoni wedge: White d5 + e4; Black c5 + d6 with a half-open e-file."""
    w, b = _names(board, chess.WHITE), _names(board, chess.BLACK)
    if {"d5", "e4"} <= w and {"c5", "d6"} <= b and 4 not in _files(board, chess.BLACK):
        return 0.85
    if {"d4", "e5"} <= b and {"c4", "d3"} <= w and 4 not in _files(board, chess.WHITE):  # mirrored
        return 0.6
    return 0.0


def classify_structure(board: chess.Board) -> dict:
    """Pattern-match the board to a named pawn structure.

    Returns {structure_class, confidence}. structure_class is one of
    IQP / Carlsbad / Maroczy / unknown. Never forces a label — a weak or absent
    match yields {"unknown", 0.0}. Highest-confidence candidate wins.
    """
    candidates: list[tuple[str, float]] = []
    for color in (chess.WHITE, chess.BLACK):
        c = _iqp_confidence(board, color)
        if c:
            candidates.append(("IQP", c))
    for cls, conf in (
        ("Carlsbad", _carlsbad_confidence(board)),
        ("Maroczy", _maroczy_confidence(board)),
        ("French", _french_confidence(board)),
        ("Stonewall", _stonewall_confidence(board)),
        ("King's Indian", _kings_indian_confidence(board)),
        ("Benoni", _benoni_confidence(board)),
    ):
        if conf:
            candidates.append((cls, conf))

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
