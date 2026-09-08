import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { devices } from "playwright";
import {
  availablePort,
  deviceFor,
  failures,
  imageFor,
  ownsContainer,
  ownsProcess,
  parseArgs,
  processIdentity,
  resolvePath,
  resultJson,
  slug,
  targetUrl,
  reviewUrl,
  acquirePortLease,
  releasePortLease,
  serverIdentity,
} from "./ux-review/core.mjs";

test("CLI transport preserves literal code and uses controller options before cli", () => {
  const code = "async page => page.getByRole('button', { name: '$HOME `literal`' }).click()";
  assert.deepEqual(parseArgs(["--", "--session", "test", "cli", "run-code", code]), {
    command: "cli",
    options: { session: "test" },
    positional: ["run-code", code],
  });
  assert.equal(parseArgs(["start", "--device=iPhone 13 Mini"]).options.device, "iPhone 13 Mini");
  for (const args of [["start", "--bad"], ["start", "--device"], ["start", "extra"], ["oops"]])
    assert.throws(() => parseArgs(args));
  for (const value of ["../other", "", "-bad", "A", "a/b", "x".repeat(49)])
    assert.throws(() => slug(value));
});

test("review ports and lifetime leases isolate owners even while their server is down", async () => {
  assert.equal(reviewUrl({ port: "4182", route: "/?review=1" }), "http://127.0.0.1:4182/?review=1");
  for (const port of ["0", "80", "65536", "1.2", "abc"]) assert.throws(() => reviewUrl({ port }));
  assert.throws(() => reviewUrl({ url: "http://localhost:4182", port: "4182" }));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${probe.address().port}`;
  await new Promise((resolve) => probe.close(resolve));
  const lease = await acquirePortLease(url, { token: "test-owner", root: "/one" });
  try {
    await assert.rejects(acquirePortLease(url, { token: "other", root: "/two" }), /reserved/);
    await assert.rejects(releasePortLease(lease, "other"), /mismatch/);
  } finally {
    await releasePortLease(lease, "test-owner");
  }
});

test("server identity rejects another worktree or a restarted server on the same URL", async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ root: "/one", token: "server-a" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await serverIdentity(url, "/one", "server-a")).token, "server-a");
    await assert.rejects(serverIdentity(url, "/two", "server-a"), /identity/);
    await assert.rejects(serverIdentity(url, "/one", "server-b"), /identity/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("device validation rejects implicit fallbacks and absent descriptors", () => {
  assert.equal(deviceFor(devices, "iPhone 13 Mini", "webkit").viewport.width, 375);
  assert.throws(() => deviceFor(devices, "iPhone 13 Mini", "chromium"), /requires webkit/);
  assert.throws(() => deviceFor(devices, "missing", "webkit"), /Unknown/);
  assert.equal(imageFor("1.62.1"), "mcr.microsoft.com/playwright:v1.62.1-noble");
});

test("paths reject traversal, root mounts, and symlink escapes before file access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ux-path-test-"));
  try {
    const root = path.join(directory, "repo");
    await mkdir(root);
    await symlink(directory, path.join(root, "escape"));
    assert.equal(await resolvePath(root, "output/new"), path.join(root, "output/new"));
    await assert.rejects(resolvePath(root, "../outside"));
    await assert.rejects(resolvePath(root, "escape/new"));
    await assert.rejects(resolvePath(root, ".", { outside: true }));
    await assert.rejects(resolvePath(root, "/", { outside: true }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("URL validation cannot escape local origin or include credentials", () => {
  assert.equal(targetUrl(undefined, "/?review=1"), "http://127.0.0.1:4173/?review=1");
  for (const url of ["https://example.com", "http://user:password@localhost", "file:///tmp/x"])
    assert.throws(() => targetUrl(url));
  for (const route of ["//example.com", "/\\example.com", "https://example.com"])
    assert.throws(() => targetUrl(undefined, route));
});

test("occupied ports fail without attaching to or stopping their listener", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await assert.rejects(availablePort(`http://127.0.0.1:${address.port}`), /occupied/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ownership rejects recycled PIDs, foreign commands, and foreign containers", async () => {
  const actual = await processIdentity(process.pid);
  const entry = actual.cmdline.split("\0").find((item) => item.endsWith("ux-review.test.mjs"));
  assert.equal(ownsProcess(actual, actual, actual.cwd, entry), true);
  assert.equal(ownsProcess({ ...actual, startTicks: "0" }, actual, actual.cwd, entry), false);
  assert.equal(ownsProcess(actual, actual, actual.cwd, "/foreign/server.mjs"), false);
  assert.equal(ownsProcess(actual, null, actual.cwd, entry), false);
  const manifest = { containerId: "abc", imageId: "sha256:test", root: "/repo", token: "unique" };
  const info = {
    Id: "abc",
    Image: "sha256:test",
    Config: { Labels: { "chess-mcp.ux.root": "/repo", "chess-mcp.ux.token": "unique" } },
  };
  assert.equal(ownsContainer(manifest, info), true);
  assert.equal(ownsContainer({ ...manifest, token: "foreign" }, info), false);
  assert.equal(ownsContainer({ ...manifest, imageId: "changed" }, info), false);
});

test("fault policy retains every failure kind and only excuses ResizeObserver page/console noise", () => {
  const records = [
    "console.error",
    "console.warning",
    "pageerror",
    "crash",
    "http",
    "requestfailed",
    "external",
  ].map((kind) => ({ kind, detail: "test failure" }));
  assert.deepEqual(failures(records), records);
  const noise = "ResizeObserver loop completed with undelivered notifications";
  assert.deepEqual(failures([{ kind: "pageerror", detail: noise }]), []);
  assert.equal(failures([{ kind: "external", detail: noise }]).length, 1);
  assert.throws(() => failures(undefined), /missing/);
  assert.throws(() => resultJson("### Error\nFailed"), /invalid structured/);
  assert.deepEqual(resultJson('{"ok":true}'), { ok: true });
});
