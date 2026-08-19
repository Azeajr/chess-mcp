/**
 * Deterministic rule-based findings. An axe pass is one evidence tier, never proof the whole
 * experience is accessible — the verdict engine must not treat an empty violation list as a
 * "confirmed-pass" for anything beyond the specific rules axe checks.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright/test";
import type { AxeEvidence, AxeViolation } from "../evidence-schema";

type SupportedBrowser = "chromium" | "firefox" | "webkit";

export async function captureAxe(page: Page, browser: SupportedBrowser): Promise<AxeEvidence> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations: AxeViolation[] = results.violations.map((violation) => ({
    ruleId: violation.id,
    impact: (violation.impact ?? null) as AxeViolation["impact"],
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    wcagTags: violation.tags.filter((tag) => /^wcag\d/u.test(tag)),
    targets: violation.nodes.flatMap((node) => node.target.map(String)),
    failureSummary: violation.nodes[0]?.failureSummary ?? null,
  }));
  return {
    source: "axe-core",
    browser,
    url: page.url(),
    violations,
    passedRuleCount: results.passes.length,
    capturedAt: new Date().toISOString(),
  };
}
