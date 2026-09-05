import assert from "node:assert/strict";
import test from "node:test";

import { fetchJson, fetchText } from "../../src/apiclient.ts";
import { withFakeClock, stubFetch, jsonResponse as json } from "./net-helpers.ts";

test("fetchJson returns the parsed body of a successful response", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => json({ depth: 30, knodes: 1 }));
    assert.deepEqual(await fetchJson("https://example.test/a"), { depth: 30, knodes: 1 });
  } finally {
    clock.restore();
  }
});

test("fetchJson passes the caller's headers through to fetch", async () => {
  const clock = withFakeClock();
  try {
    const stub = stubFetch(() => json({}));
    const pending = fetchJson("https://example.test/a", { Authorization: "Bearer t" });
    clock.tick(1000);
    await pending;
    assert.deepEqual(stub.calls[0]?.init?.headers, { Authorization: "Bearer t" });
  } finally {
    clock.restore();
  }
});

test("fetchJson degrades to null for a non-200, a thrown fetch, and an unparseable body", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => json({ error: "nope" }, 404));
    let pending = fetchJson("https://example.test/a");
    clock.tick(1000);
    assert.equal(await pending, null, "non-200");

    stubFetch(() => {
      throw new TypeError("network down");
    });
    pending = fetchJson("https://example.test/b");
    clock.tick(1000);
    assert.equal(await pending, null, "fetch threw");

    stubFetch(() => new Response("not json", { status: 200 }));
    pending = fetchJson("https://example.test/c");
    clock.tick(1000);
    assert.equal(await pending, null, "body is not JSON");
  } finally {
    clock.restore();
  }
});

test("fetchJson treats a 500 as a miss rather than an error", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => json({}, 500));
    const pending = fetchJson("https://example.test/a");
    clock.tick(1000);
    assert.equal(await pending, null);
  } finally {
    clock.restore();
  }
});

test("fetchText returns the body as text and null on failure", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => new Response("1. e4 e5 *", { status: 200 }));
    let pending = fetchText("https://example.test/a");
    clock.tick(1000);
    assert.equal(await pending, "1. e4 e5 *");

    stubFetch(() => new Response("", { status: 503 }));
    pending = fetchText("https://example.test/b");
    clock.tick(1000);
    assert.equal(await pending, null);
  } finally {
    clock.restore();
  }
});

test("consecutive requests are spaced at least a second apart", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => json({}));
    const started = clock.now();

    await fetchJson("https://example.test/1");
    for (const path of ["2", "3"]) {
      const pending = fetchJson(`https://example.test/${path}`);
      clock.tick(1000);
      await pending;
    }

    assert.equal(clock.now() - started, 2000, "two further requests cost a second each");
  } finally {
    clock.restore();
  }
});

test("a 429 holds the next request for the full cooldown, not just the usual second", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => json({ error: "rate limited" }, 429));
    const throttled = fetchJson("https://example.test/1");
    clock.tick(1000);
    assert.equal(await throttled, null, "the caller still just sees a miss");

    const stub = stubFetch(() => json({ ok: true }));
    const next = fetchJson("https://example.test/2");

    clock.tick(1000);
    await Promise.resolve();
    assert.equal(stub.calls.length, 0, "a second later the next request has not been sent");

    clock.tick(59_000);
    await next;
    assert.equal(stub.calls.length, 1, "it goes out once the cooldown has elapsed");
  } finally {
    clock.restore();
  }
});

test("an already-aborted signal produces null without sending a request", async () => {
  const clock = withFakeClock();
  try {
    const stub = stubFetch(() => json({}));
    const controller = new AbortController();
    controller.abort();

    const pending = fetchJson("https://example.test/a", undefined, controller.signal);
    clock.tick(1000);
    assert.equal(await pending, null);
    assert.equal(stub.calls.length, 0, "nothing was sent");
  } finally {
    clock.restore();
  }
});

test("aborting while queued behind the limiter produces null", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => json({}));
    await fetchJson("https://example.test/1");

    const controller = new AbortController();
    const queued = fetchJson("https://example.test/2", undefined, controller.signal);
    controller.abort();
    clock.tick(1000);
    assert.equal(await queued, null);
  } finally {
    clock.restore();
  }
});
