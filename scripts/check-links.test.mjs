import assert from "node:assert/strict";
import test from "node:test";

import { collectLinkProblems, resolveLinkTarget } from "./check-links.mjs";

const check = (files, tracked) =>
  collectLinkProblems({
    files: Object.keys(files),
    tracked,
    read: (file) => Promise.resolve(files[file]),
  });

test("a link only an untracked or ignored file satisfies is reported", async () => {
  // PR #58's failure: the evidence directory is gitignored, so the link resolved on the machine
  // that wrote it and on no other.
  const problems = await check(
    { "REMAINING-WORK.md": "See [the run](.ux-review/session/review.md) for the record.\n" },
    ["REMAINING-WORK.md", "docs/UX_REVIEW.md"],
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^REMAINING-WORK\.md:1: link resolves to no tracked file/);
  assert.match(problems[0], /\.ux-review\/session\/review\.md/);
});

test("tracked files, directories, anchors and external targets all pass", async () => {
  const problems = await check(
    {
      "README.md": [
        "[verify](#verify)",
        "[docs](docs/UX_REVIEW.md)",
        "[the directory](docs/)",
        "[with anchor](docs/UX_REVIEW.md#state-and-evidence)",
        "[with query](docs/UX_REVIEW.md?plain=1)",
        "[encoded](docs/a%20space.md)",
        "[site](https://example.com/missing.md)",
        "[mail](mailto:someone@example.com)",
        "[angle](<docs/UX_REVIEW.md>)",
        "[root absolute](/docs/UX_REVIEW.md)",
        "[reference]: docs/UX_REVIEW.md",
      ].join("\n\n"),
      "docs/UX_REVIEW.md": "[back](../README.md)\n",
    },
    ["README.md", "docs/UX_REVIEW.md", "docs/a space.md"],
  );
  assert.deepEqual(problems, []);
});

test("a link that climbs out of the repository is reported as such", async () => {
  const problems = await check({ "docs/UX_REVIEW.md": "[outside](../../elsewhere.md)\n" }, [
    "docs/UX_REVIEW.md",
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /leaves the repository/);
});

test("every link on a line is checked, and the line number is the link's own", async () => {
  const problems = await check(
    {
      "README.md": [
        "# Title",
        "",
        "[ok](docs/UX_REVIEW.md) and [missing](docs/GONE.md)",
        "",
        "![image](assets/missing.png)",
      ].join("\n"),
    },
    ["README.md", "docs/UX_REVIEW.md"],
  );
  assert.deepEqual(
    problems.map((problem) => problem.split(":").slice(0, 2).join(":")),
    ["README.md:3", "README.md:5"],
  );
});

test("resolveLinkTarget ignores what is not a repository path", () => {
  assert.equal(resolveLinkTarget("README.md", "#anchor"), null);
  assert.equal(resolveLinkTarget("README.md", "https://example.com"), null);
  assert.equal(resolveLinkTarget("README.md", "   "), null);
  assert.deepEqual(resolveLinkTarget("docs/a/b.md", "../c.md"), {
    escapes: false,
    path: "docs/c.md",
  });
});
