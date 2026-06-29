/**
 * Game-history fetch (port of #25 lichess_games / chesscom_games). Metadata is parsed uniformly
 * from PGN headers (both platforms emit them); full PGN attached only on request. Over the
 * rate-limited, offline-safe apiclient — offline / unknown user → null.
 */
import { parsePgn, makePgn, type Game, type PgnNodeData } from "chessops/pgn";
import { fetchText, fetchJson } from "./apiclient.js";

export interface GameMeta {
  white: string;
  black: string;
  result: string;
  white_elo: number | null;
  black_elo: number | null;
  eco: string | null;
  opening: string | null;
  date: string | null;
  time_control: string | null;
  /** which color the queried user played, if identifiable. */
  user_color: "white" | "black" | null;
  /** result from the user's POV. */
  user_result: "win" | "loss" | "draw" | null;
  /** full PGN, only when include_pgn. */
  pgn?: string;
}

const num = (s: string | null): number | null => (s == null || s === "" ? null : Number.isNaN(Number(s)) ? null : Number(s));

function metaFromGame(game: Game<PgnNodeData>, username: string, includePgn: boolean): GameMeta {
  const h = (k: string) => game.headers.get(k) ?? null;
  const white = h("White") ?? "?";
  const black = h("Black") ?? "?";
  const result = h("Result") ?? "*";
  const u = username.toLowerCase();
  const userColor = white.toLowerCase() === u ? "white" : black.toLowerCase() === u ? "black" : null;
  let userResult: GameMeta["user_result"] = null;
  if (userColor) {
    if (result === "1/2-1/2") userResult = "draw";
    else if (result === "1-0") userResult = userColor === "white" ? "win" : "loss";
    else if (result === "0-1") userResult = userColor === "black" ? "win" : "loss";
  }
  const meta: GameMeta = {
    white,
    black,
    result,
    white_elo: num(h("WhiteElo")),
    black_elo: num(h("BlackElo")),
    eco: h("ECO"),
    opening: h("Opening"),
    date: h("UTCDate") ?? h("Date"),
    time_control: h("TimeControl"),
    user_color: userColor,
    user_result: userResult,
  };
  if (includePgn) meta.pgn = makePgn(game);
  return meta;
}

const filterEco = (games: GameMeta[], eco?: string) =>
  eco ? games.filter((g) => (g.eco ?? "").toUpperCase().startsWith(eco.toUpperCase())) : games;

/** Recent games for a Lichess user (PGN export). Returns null offline / unknown user. */
export async function lichessGames(
  username: string,
  maxGames: number,
  openingEco?: string,
  includePgn = false,
): Promise<GameMeta[] | null> {
  const n = Math.max(1, Math.min(100, maxGames));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${n}`;
  const text = await fetchText(url, { Accept: "application/x-chess-pgn" });
  if (text === null) return null;
  return filterEco(
    parsePgn(text).map((g) => metaFromGame(g, username, includePgn)),
    openingEco,
  );
}

/** Games for a Chess.com user in a given month (published-data API). Null offline / unknown. */
export async function chesscomGames(
  username: string,
  year: number,
  month: number,
  openingEco?: string,
  includePgn = false,
): Promise<GameMeta[] | null> {
  const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${String(year).padStart(4, "0")}/${String(month).padStart(2, "0")}`;
  const data = await fetchJson<{ games?: { pgn?: string }[] }>(url);
  if (!data) return null;
  const out: GameMeta[] = [];
  for (const g of data.games ?? []) {
    if (!g.pgn) continue;
    const game = parsePgn(g.pgn)[0];
    if (game) out.push(metaFromGame(game, username, includePgn));
  }
  return filterEco(out, openingEco);
}
