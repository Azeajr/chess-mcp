import { pathToFileURL } from "node:url";

import { contractsForHost } from "../packages/chess-tools/src/index.ts";
import { BROWSER_COMMAND_ERROR_CODES } from "../apps/ui/src/application/browser-commands/types.ts";
import { ERROR_CONTENT } from "../apps/ui/src/content/errors.ts";
import { TOOL_LABELS } from "../apps/ui/src/content/tools.ts";

export function assertContentCoverage({ contractNames, toolLabels, errorCodes, errors }) {
  const missingTools = contractNames.filter((name) => !(name in toolLabels));
  const missingErrors = errorCodes.filter((code) => !(code in errors));
  if (!missingTools.length && !missingErrors.length) return;

  const failures = [
    missingTools.length ? `browser tools without labels: ${missingTools.join(", ")}` : null,
    missingErrors.length ? `browser errors without content: ${missingErrors.join(", ")}` : null,
  ].filter(Boolean);
  throw new Error(`Content registry is incomplete\n${failures.join("\n")}`);
}

export function checkContent() {
  assertContentCoverage({
    contractNames: contractsForHost("browser").map((contract) => contract.name),
    toolLabels: TOOL_LABELS,
    errorCodes: BROWSER_COMMAND_ERROR_CODES,
    errors: ERROR_CONTENT,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkContent();
  console.log(
    `Content registry covers ${Object.keys(TOOL_LABELS).length} browser tools and ${BROWSER_COMMAND_ERROR_CODES.length} browser error codes.`,
  );
}
