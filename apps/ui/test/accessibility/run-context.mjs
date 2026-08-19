import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Plain .mjs, not .ts: capture.mjs runs under plain `node` with no TS loader and must import
 * this directly. compute-verdict.ts (run via tsx) and ag-1-dialog.spec.ts (run via Playwright's
 * own TS transform) can both import a .mjs file without any loader concession on their side, so
 * this is the one shared source rather than three copies.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** One run ID per invocation, read back from LAST_RUN_ID_FILE by the verdict step. */
export const RUN_ID = process.env.A11Y_RUN_ID ?? new Date().toISOString().replace(/[:.]/gu, "-");

export const EVIDENCE_ROOT = path.join(here, "../../test-results/accessibility");
export const EVIDENCE_DIR = path.join(EVIDENCE_ROOT, RUN_ID);
export const LAST_RUN_ID_FILE = path.join(EVIDENCE_ROOT, ".last-run-id");
