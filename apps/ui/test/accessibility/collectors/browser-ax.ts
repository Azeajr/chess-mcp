/**
 * Browser-computed accessibility-tree evidence. This is the primary evidence tier: the engine's
 * own serialization of the accessibility tree, not a hand-rolled approximation of one (see
 * apps/ui/test/e2e/helpers/accessibility.ts, which reads DOM attributes and only approximates
 * name computation and aria-hidden — kept for its own checks, superseded here as evidence for
 * this pipeline).
 */
import type { CDPSession, Locator, Page } from "playwright/test";
import type { AriaSnapshotEvidence, CdpAxNode, CdpAxTreeEvidence } from "../evidence-schema";

type SupportedBrowser = "chromium" | "firefox" | "webkit";

export async function captureAriaSnapshot(
  locator: Locator,
  browser: SupportedBrowser,
  locatorDescription: string,
): Promise<AriaSnapshotEvidence> {
  const snapshot = await locator.ariaSnapshot();
  return {
    source: "playwright-aria-snapshot",
    browser,
    locatorDescription,
    snapshot,
    capturedAt: new Date().toISOString(),
  };
}

interface CdpAxNodeRaw {
  nodeId: string;
  ignored: boolean;
  ignoredReasons?: { name: string }[];
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
}

/**
 * Chromium-only diagnostic depth: which nodes the engine chose to omit from the exposed tree,
 * and why. Never treated as a cross-browser correctness gate — see evidence-schema.ts.
 */
export async function captureCdpAxTree(page: Page): Promise<CdpAxTreeEvidence> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: CdpAxNodeRaw[];
    };
    const normalized: CdpAxNode[] = nodes.map((node) => ({
      nodeId: node.nodeId,
      role: node.role?.value ?? null,
      name: node.name?.value ?? null,
      description: node.description?.value ?? null,
      ignored: node.ignored,
      ignoredReasons: (node.ignoredReasons ?? []).map((reason) => reason.name),
    }));
    return {
      source: "cdp-full-ax-tree",
      browser: "chromium",
      nodeCount: normalized.length,
      ignoredCount: normalized.filter((node) => node.ignored).length,
      nodes: normalized,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** True only for the one engine CDP's accessibility domain is defined for. */
export function supportsCdpAxTree(browser: SupportedBrowser): browser is "chromium" {
  return browser === "chromium";
}
