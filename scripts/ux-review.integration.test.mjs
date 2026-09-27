// Opt-in Docker acceptance proof: node --test scripts/ux-review.integration.test.mjs
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "./ux-review/core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const session = `ux-proof-${process.pid}`;
const sessionPath = path.join(root, ".ux-review", session, "session.json");
const invoke = (args) =>
  run(process.execPath, ["scripts/ux-review.mjs", "--session", session, ...args], {
    cwd: root,
    timeout: 240_000,
  });
const state = async () => JSON.parse(await readFile(sessionPath, "utf8"));

test(
  "structured batches inspect rendered state, retain failure evidence and reduce round trips",
  { timeout: 300_000 },
  async () => {
    try {
      const coldStart = performance.now();
      await invoke([
        "start",
        "--browser",
        "chromium",
        "--device",
        "Desktop Chrome",
        "--port",
        "4186",
      ]);
      const startupMs = Math.round(performance.now() - coldStart);
      const sessionBefore = await state();
      const document = JSON.parse(await invoke(["state"]));
      assert.equal(document.ok, true);
      assert.equal(document.result.documentId, sessionBefore.postconditions.documentId);
      assert.equal(document.result.commands.audit_repertoire_moves.status, "idle");
      assert.equal(JSON.stringify(document.result).includes("apiKey"), false);
      const board = JSON.parse(await invoke(["observe", ".board-wrap"]));
      assert.equal(board.result.count, 1);
      assert.equal(board.result.elements[0].visible, true);
      assert.ok(board.result.elements[0].box.width > 0);
      const empty = JSON.parse(await invoke(["observe", "#absent-ux-proof"]));
      assert.equal(empty.result.count, 0);
      const journey = JSON.parse(
        await invoke(["run", "scripts/ux-review/examples/strategic-fit.js"]),
      );
      assert.equal(journey.ok, true);
      assert.equal(journey.steps.length, 2);
      assert.equal(journey.result.profile.elements[0].visible, true);
      assert.ok(journey.result.profile.elements[0].css["font-size"]);

      const probe = path.join(sessionBefore.runDir, "probe.js");
      await writeFile(
        probe,
        `async (page, { observe, assert }) => {
      // A synthetic fixture checks inspection geometry; it is removed before the next journey.
      await page.evaluate(() => {
        const root = document.createElement('div'); root.id = 'ux-inspection';
        root.style.cssText = 'position:fixed;left:10px;top:10px;width:40px;height:40px;overflow:hidden;z-index:99999';
        root.innerHTML = '<div style="width:80px;height:80px">visible text</div><span style="display:none">hidden text</span>';
        document.body.append(root);
      });
      try {
        const clipped = await observe('#ux-inspection > div', { textLimit: 3, css: ['width'], attributes: ['id'] });
        assert(clipped.elements[0].clippedBy.length > 0, 'Missing clipping ancestor');
        assert(clipped.elements[0].text === 'vis' && clipped.elements[0].textTruncated, 'Text limit failed');
        const hidden = await observe('#ux-inspection > span');
        assert(!hidden.elements[0].visible && hidden.elements[0].text === '', 'Hidden text reported visible');
        const bounded = await observe('#ux-inspection > *', { limit: 1 });
        assert(bounded.count === 2 && bounded.truncated, 'Match bound failed');
        return { clipped, hidden };
      } finally { await page.locator('#ux-inspection').evaluate(el => el.remove()); }
    }`,
      );
      assert.equal(JSON.parse(await invoke(["run", probe])).ok, true);

      await writeFile(
        probe,
        `async (page, { step, assert }) => {
      await step('deliberate assertion failure', async () => assert(false, 'ux-batch-proof'));
      await page.evaluate(() => localStorage.setItem('must-not-run', 'bad'));
    }`,
      );
      await assert.rejects(invoke(["run", probe]), /ux-batch-proof/);
      const events = (
        await readFile(path.join(root, ".ux-review", session, "events.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map(JSON.parse);
      const failedEvent = events.filter((event) => event.kind === "batch-completed").at(-1);
      const failure = JSON.parse(await readFile(failedEvent.report, "utf8"));
      assert.equal(failure.ok, false);
      assert.equal(failure.steps[0].name, "deliberate assertion failure");
      assert.equal(failure.artifacts.state.documentId, document.result.documentId);
      const png = await readFile(failure.artifacts.screenshot);
      assert.ok(png.readUInt32BE(16) > 0);
      await writeFile(
        probe,
        `async (page, { assert }) => assert(await page.evaluate(() => localStorage.getItem('must-not-run')) === null)`,
      );
      assert.equal(JSON.parse(await invoke(["run", probe])).ok, true);

      // Compare equivalent read-only work. Report timings, never enforce machine-specific thresholds.
      const separate = [];
      for (let i = 0; i < 3; i++) separate.push(JSON.parse(await invoke(["state"])));
      await writeFile(
        probe,
        `async (page, { state }) => {
      const results = []; for (let i = 0; i < 3; i++) results.push(await state()); return results;
    }`,
      );
      const batched = JSON.parse(await invoke(["run", probe]));
      assert.equal(batched.ok, true);
      assert.equal(batched.result.length, 3);
      assert.ok(
        batched.timing.transportCalls <
          separate.reduce((sum, item) => sum + item.timing.transportCalls, 0),
      );
      const measurements = {
        startupMs,
        separateMs: separate.reduce((sum, item) => sum + item.timing.totalMs, 0),
        batchedMs: batched.timing.totalMs,
        separateCalls: separate.reduce((sum, item) => sum + item.timing.transportCalls, 0),
        batchedCalls: batched.timing.transportCalls,
      };
      await writeFile(
        path.join(sessionBefore.runDir, "timings.json"),
        JSON.stringify(measurements, null, 2),
      );
      console.log(`Warm batch measurements: ${JSON.stringify(measurements)}`);
      console.log(`Failure screenshot: ${failure.artifacts.screenshot}`);
      assert.equal((await state()).containerId, sessionBefore.containerId);
      await invoke(["reset"]);
      assert.equal(
        JSON.parse(await invoke(["run", "scripts/ux-review/examples/strategic-fit.js"])).ok,
        true,
      );
      await invoke(["check"]);
    } finally {
      await invoke(["stop"]);
    }
  },
);

test(
  "Docker review retains faults, resets all storage, replays visible controls, and cleans up",
  { timeout: 300_000 },
  async () => {
    try {
      await invoke([
        "start",
        "--workflow",
        "acceptance",
        ...(process.env.UX_REVIEW_TEST_URL
          ? ["--url", process.env.UX_REVIEW_TEST_URL]
          : ["--port", "4183"]),
      ]);
      const before = await state();
      assert.equal(before.status, "ready");
      assert.deepEqual(before.postconditions.viewport, { width: 375, height: 629, dpr: 3 });
      const png = await readFile(path.join(before.runDir, "00-seeded.png"));
      assert.equal(png.readUInt32BE(16), 1125);
      assert.equal(png.readUInt32BE(20), 1887);
      await invoke([
        "cli",
        "run-code",
        `async page => {
      await page.getByRole('button', { name: 'Open Strategic Fit' }).click();
      await page.getByRole('button', { name: 'Use Balanced profile' }).click();
      await page.getByRole('heading', { name: 'How should Strategic Fit review your repertoire?' }).waitFor({state:'hidden'});
      await page.getByRole('button', { name: 'Return to repertoire' }).click();
      if (!await page.getByRole('button', { name: 'Open Strategic Fit' }).evaluate(el => el === document.activeElement)) throw new Error('Focus did not return');
      return true;
    }`,
      ]);
      await invoke(["check"]);
      const startup = JSON.parse(await readFile(path.join(before.runDir, "faults.json"), "utf8"));
      assert.deepEqual(startup.warnings, []);
      assert.ok(startup.checkedAt);
      await invoke([
        "cli",
        "run-code",
        `async page => {
      await page.context().addCookies([{ name:'ux-proof', value:'dirty', url:page.url() }]);
      await page.evaluate(async () => {
        localStorage.setItem('ux-proof', 'dirty'); sessionStorage.setItem('ux-proof', 'dirty');
        window.__chess.loadPgn('1. e4 e5 *', 'changed.pgn');
        await new Promise((resolve, reject) => { const request = indexedDB.open('ux-proof', 1); request.onupgradeneeded = () => request.result.createObjectStore('proof'); request.onerror = reject; request.onsuccess = () => { request.result.close(); resolve(); }; });
        const cache = await caches.open('ux-proof'); await cache.put('/ux-proof-cache', new Response('dirty'));
        console.error('ux-proof console failure'); console.warn('[engine] ux-proof warning');
        console.warn('ux-proof ordinary warning');
        queueMicrotask(() => { throw new Error('ux-proof page exception'); });
      });
      await page.route('**/ux-proof-abort', route => route.abort('failed'));
      await page.route('**/ux-proof-http', route => route.fulfill({status:503,body:'deliberate'}));
      const external = await page.evaluate(async () => {
        await fetch('/ux-proof-abort').catch(() => null); await fetch('/ux-proof-http');
        return (await fetch('https://ux-proof.invalid/blocked')).json();
      });
      if (external !== null) throw new Error('External response was not stubbed');
      await page.reload(); return true;
    }`,
      ]);
      await assert.rejects(invoke(["check"]), /ux-proof/);
      const report = JSON.parse(await readFile(path.join(before.runDir, "faults.json"), "utf8"));
      assert.ok(report.warnings.some((warning) => warning.detail === "ux-proof ordinary warning"));
      for (const kind of [
        "console.error",
        "console.warning",
        "pageerror",
        "http",
        "requestfailed",
        "external",
      ]) {
        assert.ok(
          report.faults.some((fault) => fault.kind === kind),
          `Missing retained ${kind} fault`,
        );
      }
      await invoke(["reset"]);
      const after = await state();
      assert.notEqual(after.runDir, before.runDir);
      assert.equal(after.containerId, before.containerId);
      assert.equal(after.seed.digest, before.seed.digest);
      assert.notEqual(after.postconditions.documentId, before.postconditions.documentId);
      assert.equal(after.postconditions.pgn, before.postconditions.pgn);
      await invoke([
        "cli",
        "run-code",
        `async page => {
      const dirty = await page.evaluate(async () => ({local:localStorage.getItem('ux-proof'),session:sessionStorage.getItem('ux-proof'),db:(await indexedDB.databases()).some(db => db.name === 'ux-proof'),cache:await caches.has('ux-proof')}));
      if (dirty.local || dirty.session || dirty.db || dirty.cache || (await page.context().cookies()).some(cookie => cookie.name === 'ux-proof')) throw new Error('Dirty state survived reset');
      await page.getByRole('button', { name: 'Open Strategic Fit' }).click();
      await page.getByRole('button', { name: 'Use Balanced profile' }).click();
      await page.getByRole('button', { name: 'Return to repertoire' }).click(); return true;
    }`,
      ]);
      await invoke(["check"]);
      await invoke(["stop"]);
      const stopped = await state();
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.containerId, null);
      assert.equal(stopped.server, null);
      if (process.env.UX_REVIEW_TEST_URL)
        assert.equal((await fetch(process.env.UX_REVIEW_TEST_URL)).status, 200);
      console.log(`Review acceptance evidence: ${before.runDir} and ${after.runDir}`);
    } finally {
      await invoke(["stop"]);
    }
  },
);

test(
  "concurrent ports retain identity and server death cannot silently continue a journey",
  { timeout: 300_000 },
  async () => {
    const a = `${session}-a`,
      b = `${session}-b`,
      external = `${session}-external`;
    const call = (name, args) =>
      run(process.execPath, ["scripts/ux-review.mjs", "--session", name, ...args], {
        cwd: root,
        timeout: 240_000,
      });
    const read = async (name) =>
      JSON.parse(await readFile(path.join(root, ".ux-review", name, "session.json"), "utf8"));
    try {
      await call(a, ["start", "--port", "4184"]);
      await call(b, ["start", "--port", "4185"]);
      await call(external, ["start", "--url", "http://127.0.0.1:4184"]);
      const first = await read(a),
        second = await read(b);
      assert.notEqual(first.identity.token, second.identity.token);
      process.kill(-first.server.pid, "SIGTERM");
      await assert.rejects(call(a, ["check"]), /server|Vite|fetch/i);
      const failed = await read(a);
      assert.equal(failed.status, "infrastructure-failed");
      const report = JSON.parse(await readFile(path.join(failed.runDir, "faults.json"), "utf8"));
      assert.ok(report.faults.some((fault) => fault.kind === "infrastructure"));
      await assert.rejects(call(a, ["cli", "snapshot"]), /reseed/);
      await call(b, ["check"]);
      await call(a, ["stop"]);
      await call(b, ["check"]);
      await call(a, ["start", "--port", "4184"]);
      await assert.rejects(call(external, ["check"]), /identity|server/i);
      await call(external, ["stop"]);
      await call(a, ["check"]);
    } finally {
      await call(external, ["stop"]);
      await call(a, ["stop"]);
      await call(b, ["stop"]);
    }
  },
);
