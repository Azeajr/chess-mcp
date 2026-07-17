import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  toPgn(): string;
  runTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  saveArtifact(id: string): boolean;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
});

test("browser V2 annotation remains a clone-only downloadable artifact", async ({ page }) => {
  const pgn = `[Event "Shallow e4"]
[Result "*"]

1. e4 e5 *

[Event "Shallow d4"]
[Result "*"]

1. d4 d5 2. c4 *

[Event "Shallow c4"]
[Result "*"]

1. c4 *`;
  await chess(page, (api, value) => api.loadPgn(value, "strategic-fit.pgn"), pgn);
  const before = await chess(page, (api) => api.toPgn());
  const result = await chess(page, (api) => api.runTool(
    "export_annotated_repertoire",
    { include: ["congruence"] },
  )) as { artifact_id?: string; annotated?: { congruence?: number } };

  expect(result.artifact_id).toBeTruthy();
  expect(result.annotated?.congruence).toBeGreaterThan(0);
  expect(await chess(page, (api) => api.toPgn())).toBe(before);

  const downloadPromise = page.waitForEvent("download");
  expect(await chess(page, (api, id) => api.saveArtifact(id), result.artifact_id!)).toBe(true);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("strategic-fit-annotated.pgn");
  const stream = await download.createReadStream();
  let annotatedPgn = "";
  for await (const chunk of stream) annotatedPgn += chunk.toString();

  expect(annotatedPgn).toContain("Strategic Fit evidence [analysis=2.0.0;");
  expect(annotatedPgn).toContain("category=uncertain;");
  expect(annotatedPgn).toContain("confidence=low");
  expect(annotatedPgn).toContain("difference=minor");
  expect(annotatedPgn).toContain("cohort=cohort:");
  expect(annotatedPgn).toContain("status=uncertain-evidence-only");
});
