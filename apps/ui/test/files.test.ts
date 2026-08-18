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
  await Promise.all([continueDocumentClose(), continueDocumentClose()]);

  assert.equal(resumes, 1);
  assert.equal(pendingDocumentClose(), null);
});
