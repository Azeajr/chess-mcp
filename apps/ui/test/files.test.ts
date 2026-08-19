import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelDocumentClose,
  continueDocumentClose,
  pendingDocumentClose,
  requestDocumentClose,
} from "../src/store/files.ts";

test("document-close resume runs at most once", async () => {
  cancelDocumentClose();
  let resumes = 0;

  requestDocumentClose("new", () => {
    resumes += 1;
  });
  requestDocumentClose("open", () => {
    resumes += 100;
  });
  // Both are issued before either awaits: WP-004 made the resume path asynchronous (it captures a
  // snapshot first), so a second Continue must find the pending close already claimed.
  const first = continueDocumentClose();
  const second = continueDocumentClose();
  await Promise.all([first, second]);

  assert.equal(resumes, 1);
  assert.equal(pendingDocumentClose(), null);
});
