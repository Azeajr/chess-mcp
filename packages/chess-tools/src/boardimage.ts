/**
 * Minimal SVG board render (port of board_image). The UI renders boards with chessground, so
 * this exists for the MCP/Claude-Code path: a self-contained SVG with unicode piece glyphs, no
 * external assets. Not a byte-for-byte match of python-chess's SVG — it's a viewable blob.
 */
const GLYPH: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

export function boardSvg(fen: string, opts: { orientation?: "white" | "black"; size?: number } = {}): string {
  const size = opts.size ?? 360;
  const orient = opts.orientation ?? "white";
  const sq = size / 8;
  const placement = fen.split(" ")[0] ?? "";
  // board[0] = rank 8 (top of FEN). Expand run-length digits to empty cells.
  const board = placement.split("/").map((row) => {
    const cells: string[] = [];
    for (const c of row) {
      if (/\d/.test(c)) for (let i = 0; i < Number(c); i++) cells.push("");
      else cells.push(c);
    }
    return cells;
  });

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const dispR = orient === "white" ? r : 7 - r;
      const dispF = orient === "white" ? f : 7 - f;
      const x = dispF * sq;
      const y = dispR * sq;
      const light = (r + f) % 2 === 0; // a8 (r0,f0) is a light square
      svg += `<rect x="${x}" y="${y}" width="${sq}" height="${sq}" fill="${light ? "#f0d9b5" : "#b58863"}"/>`;
      const piece = board[r]?.[f];
      if (piece && GLYPH[piece]) {
        svg += `<text x="${x + sq / 2}" y="${y + sq * 0.72}" font-size="${sq * 0.8}" text-anchor="middle">${GLYPH[piece]}</text>`;
      }
    }
  }
  return svg + "</svg>";
}
