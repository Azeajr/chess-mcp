import assert from "node:assert/strict";
import test from "node:test";

import { createArtifact, saveArtifact } from "../src/store/artifacts.ts";

interface FakeAnchor {
  href: string;
  download: string;
  clicked: boolean;
  click: () => void;
}

// The store reaches for an anchor and an object URL. Node has neither a document nor a real
// download, so each test installs exactly the piece of DOM the call touches and restores it after.
function withDom(options: { createObjectURL?: () => string } = {}): {
  anchors: FakeAnchor[];
  revoked: string[];
  restore: () => void;
} {
  const anchors: FakeAnchor[] = [];
  const revoked: string[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousDocument = globals.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;

  globals.document = {
    createElement: () => {
      const anchor: FakeAnchor = {
        href: "",
        download: "",
        clicked: false,
        click() {
          anchor.clicked = true;
        },
      };
      anchors.push(anchor);
      return anchor;
    },
  };
  URL.createObjectURL = options.createObjectURL ?? (() => "blob:fake");
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };

  return {
    anchors,
    revoked,
    restore: () => {
      globals.document = previousDocument;
      URL.createObjectURL = previousCreate;
      URL.revokeObjectURL = previousRevoke;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("saving an artifact hands it to the browser and reports the name", async () => {
  const dom = withDom();
  try {
    const meta = createArtifact("pgn", "1. d4 *", "line.pgn");
    const result = saveArtifact(meta.artifact_id);

    assert.deepEqual(result, { ok: true, name: "line.pgn" });
    assert.equal(dom.anchors.length, 1);
    assert.equal(dom.anchors[0]?.download, "line.pgn");
    assert.equal(dom.anchors[0]?.clicked, true);

    // Revoking in the same tick can cancel a download the browser has not started reading yet.
    assert.deepEqual(dom.revoked, []);
    await tick();
    assert.deepEqual(dom.revoked, ["blob:fake"]);
  } finally {
    dom.restore();
  }
});

test("an artifact that is no longer in the store reports a missing download", () => {
  const dom = withDom();
  try {
    // A reload empties the in-memory store, so an old result can still name an artifact that is
    // gone. Returning false here and dropping it at the call site made that case invisible.
    const result = saveArtifact("artifact-does-not-exist");

    assert.deepEqual(result, { ok: false, reason: "missing" });
    assert.equal(dom.anchors.length, 0);
  } finally {
    dom.restore();
  }
});

test("a browser that refuses the download reports it instead of throwing past the caller", () => {
  const dom = withDom({
    createObjectURL: () => {
      throw new Error("blocked");
    },
  });
  try {
    const meta = createArtifact("pgn", "1. e4 *", "blocked.pgn");
    const result = saveArtifact(meta.artifact_id);

    assert.deepEqual(result, { ok: false, reason: "blocked" });
    assert.equal(dom.anchors.length, 0);
  } finally {
    dom.restore();
  }
});
