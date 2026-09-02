import assert from "node:assert/strict";
import test from "node:test";

import { lichessGames, chesscomGames } from "../../src/index.ts";
import { withFakeClock, stubFetch, jsonResponse, oneRequest } from "./net-helpers.ts";

const pgnText = (headers: Record<string, string>, moves = "1. e4 e5 *") =>
  `${Object.entries(headers)
    .map(([key, value]) => `[${key} "${value}"]`)
    .join("\n")}\n\n${moves}\n`;

const GAME = {
  Event: "Rated blitz game",
  White: "alice",
  Black: "bob",
  Result: "1-0",
  WhiteElo: "1850",
  BlackElo: "1790",
  ECO: "C50",
  Opening: "Italian Game",
  UTCDate: "2024.03.01",
  TimeControl: "300+0",
};

const pgnResponse = (text: string) => new Response(text, { status: 200 });

test("lichessGames requests the PGN export for the user and asks for PGN explicitly", async () => {
  const clock = withFakeClock();
  try {
    const stub = stubFetch(() => pgnResponse(pgnText(GAME)));
    await oneRequest(clock, () => lichessGames("alice", 10));

    assert.match(stub.calls[0]?.url ?? "", /^https:\/\/lichess\.org\/api\/games\/user\/alice\?/u);
    assert.deepEqual(stub.calls[0]?.init?.headers, { Accept: "application/x-chess-pgn" });
  } finally {
    clock.restore();
  }
});

test("lichessGames clamps the requested count into 1..100", async () => {
  const clock = withFakeClock();
  try {
    for (const [asked, expected] of [
      [10, 10],
      [0, 1],
      [-5, 1],
      [500, 100],
    ] as const) {
      const stub = stubFetch(() => pgnResponse(pgnText(GAME)));
      await oneRequest(clock, () => lichessGames("alice", asked));
      assert.match(stub.calls[0]?.url ?? "", new RegExp(`max=${expected}$`, "u"), `asked ${asked}`);
    }
  } finally {
    clock.restore();
  }
});

test("lichessGames percent-encodes a username so it cannot alter the path", async () => {
  const clock = withFakeClock();
  try {
    const stub = stubFetch(() => pgnResponse(pgnText(GAME)));
    await oneRequest(clock, () => lichessGames("a/../b", 5));
    assert.match(stub.calls[0]?.url ?? "", /user\/a%2F\.\.%2Fb\?/u);
  } finally {
    clock.restore();
  }
});

test("lichessGames parses metadata out of the PGN headers", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => pgnResponse(pgnText(GAME)));
    const games = await oneRequest(clock, () => lichessGames("alice", 1));
    assert.equal(games?.length, 1);
    assert.deepEqual(games?.[0], {
      white: "alice",
      black: "bob",
      result: "1-0",
      white_elo: 1850,
      black_elo: 1790,
      eco: "C50",
      opening: "Italian Game",
      date: "2024.03.01",
      time_control: "300+0",
      user_color: "white",
      user_result: "win",
    });
  } finally {
    clock.restore();
  }
});

/** The username decides the POV, and platforms do not agree on casing. */
test("lichessGames identifies the queried user's colour regardless of case", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => pgnResponse(pgnText(GAME)));
    const asBlack = await oneRequest(clock, () => lichessGames("BOB", 1));
    assert.equal(asBlack?.[0]?.user_color, "black");
    assert.equal(asBlack?.[0]?.user_result, "loss", "Black lost this 1-0 game");

    stubFetch(() => pgnResponse(pgnText(GAME)));
    const stranger = await oneRequest(clock, () => lichessGames("carol", 1));
    assert.equal(stranger?.[0]?.user_color, null);
    assert.equal(stranger?.[0]?.user_result, null, "no POV means no result to report");
  } finally {
    clock.restore();
  }
});

test("lichessGames maps every result to the queried user's point of view", async () => {
  const clock = withFakeClock();
  try {
    for (const [result, forWhite, forBlack] of [
      ["1-0", "win", "loss"],
      ["0-1", "loss", "win"],
      ["1/2-1/2", "draw", "draw"],
      ["*", null, null],
    ] as const) {
      stubFetch(() => pgnResponse(pgnText({ ...GAME, Result: result })));
      const white = await oneRequest(clock, () => lichessGames("alice", 1));
      assert.equal(white?.[0]?.user_result, forWhite, `${result} as White`);

      stubFetch(() => pgnResponse(pgnText({ ...GAME, Result: result })));
      const black = await oneRequest(clock, () => lichessGames("bob", 1));
      assert.equal(black?.[0]?.user_result, forBlack, `${result} as Black`);
    }
  } finally {
    clock.restore();
  }
});

test("lichessGames reports a missing or unparseable rating as null rather than zero or NaN", async () => {
  const clock = withFakeClock();
  try {
    const { WhiteElo: _white, BlackElo: _black, ...noRatings } = GAME;
    stubFetch(() => pgnResponse(pgnText({ ...noRatings, BlackElo: "?" })));
    const games = await oneRequest(clock, () => lichessGames("alice", 1));
    assert.equal(games?.[0]?.white_elo, null, "absent header");
    assert.equal(games?.[0]?.black_elo, null, "non-numeric header");
  } finally {
    clock.restore();
  }
});

test("lichessGames falls back from UTCDate to Date", async () => {
  const clock = withFakeClock();
  try {
    const { UTCDate: _utc, ...noUtc } = GAME;
    stubFetch(() => pgnResponse(pgnText({ ...noUtc, Date: "2023.12.25" })));
    const games = await oneRequest(clock, () => lichessGames("alice", 1));
    assert.equal(games?.[0]?.date, "2023.12.25");
  } finally {
    clock.restore();
  }
});

test("lichessGames attaches the full PGN only when it is asked for", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => pgnResponse(pgnText(GAME)));
    const without = await oneRequest(clock, () => lichessGames("alice", 1));
    assert.equal("pgn" in (without?.[0] ?? {}), false);

    stubFetch(() => pgnResponse(pgnText(GAME)));
    const withPgn = await oneRequest(clock, () => lichessGames("alice", 1, undefined, true));
    assert.match(withPgn?.[0]?.pgn ?? "", /e4/u);
  } finally {
    clock.restore();
  }
});

/** The ECO filter is a case-insensitive prefix, so "C" selects a whole volume. */
test("lichessGames filters by ECO prefix, case-insensitively", async () => {
  const clock = withFakeClock();
  try {
    const two = `${pgnText(GAME)}\n${pgnText({ ...GAME, ECO: "B20", Opening: "Sicilian" })}`;

    stubFetch(() => pgnResponse(two));
    assert.equal((await oneRequest(clock, () => lichessGames("alice", 5)))?.length, 2);

    stubFetch(() => pgnResponse(two));
    const volumeC = await oneRequest(clock, () => lichessGames("alice", 5, "c"));
    assert.equal(volumeC?.length, 1);
    assert.equal(volumeC?.[0]?.eco, "C50");

    stubFetch(() => pgnResponse(two));
    assert.equal((await oneRequest(clock, () => lichessGames("alice", 5, "A")))?.length, 0);
  } finally {
    clock.restore();
  }
});

test("lichessGames returns null when the user is unknown or the network is down", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => new Response("", { status: 404 }));
    assert.equal(await oneRequest(clock, () => lichessGames("nobody", 5)), null);
  } finally {
    clock.restore();
  }
});

test("chesscomGames zero-pads the year and month in the archive path", async () => {
  const clock = withFakeClock();
  try {
    const stub = stubFetch(() => jsonResponse({ games: [] }));
    await oneRequest(clock, () => chesscomGames("alice", 2024, 3));
    assert.match(stub.calls[0]?.url ?? "", /\/games\/2024\/03$/u);
  } finally {
    clock.restore();
  }
});

test("chesscomGames reads each archived game's embedded PGN", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({ games: [{ pgn: pgnText(GAME) }] }));
    const games = await oneRequest(clock, () => chesscomGames("alice", 2024, 3));
    assert.equal(games?.length, 1);
    assert.equal(games?.[0]?.white, "alice");
    assert.equal(games?.[0]?.user_result, "win");
  } finally {
    clock.restore();
  }
});

test("chesscomGames skips archive entries that carry no PGN", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({ games: [{}, { pgn: pgnText(GAME) }, { pgn: "" }] }));
    const games = await oneRequest(clock, () => chesscomGames("alice", 2024, 3));
    assert.equal(games?.length, 1, "only the entry with a PGN survives");
  } finally {
    clock.restore();
  }
});

test("chesscomGames treats an archive with no games key as empty, not as a failure", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({}));
    assert.deepEqual(await oneRequest(clock, () => chesscomGames("alice", 2024, 3)), []);
  } finally {
    clock.restore();
  }
});

test("chesscomGames returns null when the archive cannot be fetched", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({ message: "not found" }, 404));
    assert.equal(await oneRequest(clock, () => chesscomGames("nobody", 2024, 3)), null);
  } finally {
    clock.restore();
  }
});
