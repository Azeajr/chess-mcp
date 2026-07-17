import { expect, test, type Download, type Page } from "playwright/test";
import { GameTree } from "@chess-mcp/chess-tools";

type ChessHarness = {
  documentId(): string;
  version(): number;
  toPgn(): string;
  loadPgn(pgn: string, name?: string): void;
  strategicFitMetadata(): Record<string, any>;
  strategicFitMetadataStatus(): string;
  replaceStrategicFitMetadata(value: unknown): { state: string };
  flushStrategicFitMetadata(documentId?: string): Promise<void>;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)(
    (window as unknown as { __chess: ChessHarness }).__chess,
    arg,
  ),
  { source: fn.toString(), arg },
);

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function waitForMetadata(page: Page) {
  await expect.poll(() => chess(page, (api) => api.strategicFitMetadataStatus())).toBe("ready");
}

async function portability(page: Page) {
  const section = page.getByText("Strategic Fit portability", { exact: true });
  await section.click();
}

test("Strategic Fit sidecar UI previews, cancels, confirms, persists, and saves secret-free JSON", async ({ page }) => {
  await page.goto("/");
  await waitForMetadata(page);
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6 *", "sidecar.pgn"));
  await waitForMetadata(page);
  const initial = await chess(page, (api) => {
    const metadata = api.strategicFitMetadata();
    api.replaceStrategicFitMetadata({
      ...metadata,
      profile: {
        ...metadata.profile,
        source: "explicit",
        provisional: false,
        credentials: { token: "must-not-export" },
      },
      lichess_token: "must-not-export",
    });
    return { documentId: api.documentId(), pgn: api.toPgn(), version: api.version() };
  });
  await portability(page);

  await page.getByRole("button", { name: "Generate metadata JSON" }).click();
  const jsonDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save metadata JSON" }).click();
  const jsonDownload = await jsonDownloadEvent;
  expect(jsonDownload.suggestedFilename()).toBe("sidecar-strategic-fit.json");
  const json = await downloadText(jsonDownload);
  expect(json).not.toMatch(/must-not-export|lichess_token|credentials/);
  const exported = JSON.parse(json);
  expect(exported.document_id).toBe(initial.documentId);
  expect(exported.sidecar_version).toBe("1.0.0");

  const incoming = await chess(page, (api) => {
    const metadata = api.strategicFitMetadata();
    return {
      sidecar_kind: "chess-mcp/strategic-fit-sidecar",
      sidecar_version: "1.0.0",
      document_id: "123e4567-e89b-42d3-a456-426614174099",
      metadata: {
        ...metadata,
        profile: {
          ...metadata.profile,
          mode: "custom",
          source: "explicit",
          provisional: false,
          preferences: {
            ...metadata.profile.preferences,
            preferred_concept_ids: ["concept:imported"],
          },
        },
      },
    };
  });
  const picker = page.getByLabel("Choose Strategic Fit metadata JSON");
  await picker.setInputFiles({
    name: "incoming.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(incoming)),
  });
  await expect(page.getByRole("region", { name: "Strategic Fit metadata import preview" })).toBeVisible();
  await expect(page.getByText("I understand this sidecar belongs to a different document ID.")).toBeVisible();
  expect(await chess(page, (api) => api.strategicFitMetadata().profile.preferences.preferred_concept_ids)).toEqual([]);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("region", { name: "Strategic Fit metadata import preview" })).toBeHidden();
  expect(await chess(page, (api) => api.strategicFitMetadata().profile.preferences.preferred_concept_ids)).toEqual([]);

  await picker.setInputFiles({
    name: "incoming.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(incoming)),
  });
  await page.getByLabel("I understand this sidecar belongs to a different document ID.").check();
  await page.getByRole("button", { name: "Confirm metadata import" }).click();
  await expect(page.getByRole("status")).toContainText("Strategic Fit metadata imported and saved.");
  expect(await chess(page, (api) => api.strategicFitMetadata().profile.preferences.preferred_concept_ids)).toEqual(["concept:imported"]);
  expect(await chess(page, (api) => ({ pgn: api.toPgn(), version: api.version() }))).toEqual({
    pgn: initial.pgn,
    version: initial.version,
  });
  await page.reload();
  await waitForMetadata(page);
  expect(await chess(page, (api) => api.strategicFitMetadata().profile.preferences.preferred_concept_ids)).toEqual(["concept:imported"]);
});

test("sidecar UI rejects malformed and stale/cross-document previews without mutation", async ({ page }) => {
  await page.goto("/");
  await waitForMetadata(page);
  await portability(page);
  const picker = page.getByLabel("Choose Strategic Fit metadata JSON");
  await picker.setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByRole("alert")).toContainText("not valid JSON");

  const incoming = await chess(page, (api) => ({
    sidecar_kind: "chess-mcp/strategic-fit-sidecar",
    sidecar_version: "1.0.0",
    document_id: api.documentId(),
    metadata: api.strategicFitMetadata(),
  }));
  await picker.setInputFiles({
    name: "stale.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(incoming)),
  });
  await chess(page, (api) => api.loadPgn("1. d4 d5 *", "other.pgn"));
  await page.getByRole("button", { name: "Confirm metadata import" }).click();
  await expect(page.getByRole("alert")).toContainText("changed after this preview");
  expect(await chess(page, (api) => api.strategicFitMetadata().profile.preferences.preferred_concept_ids)).toEqual([]);
});

test("portable intent PGN saves through the canonical UI command and reparses without changing the source", async ({ page }) => {
  await page.goto("/");
  await waitForMetadata(page);
  await chess(page, (api) => {
    api.loadPgn("1. e4 e5 2. Nf3 Nc6 *\n\n1. d4 d5 2. c4 e6 *\n\n1. c4 e5 2. Nc3 Nf6 *", "intent.pgn");
    const metadata = api.strategicFitMetadata();
    api.replaceStrategicFitMetadata({
      ...metadata,
      profile: { ...metadata.profile, mode: "balanced", source: "explicit", provisional: false },
    });
  });
  await waitForMetadata(page);
  const before = await chess(page, (api) => ({ pgn: api.toPgn(), version: api.version() }));
  await portability(page);
  await page.getByRole("button", { name: "Generate intent PGN" }).click();
  await expect(page.getByRole("button", { name: "Save intent PGN" })).toBeVisible({ timeout: 20_000 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save intent PGN" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("intent-strategic-fit-intent.pgn");
  const pgn = await downloadText(download);
  expect(pgn).toContain("Strategic Fit intent");
  expect(() => GameTree.fromPgn(pgn)).not.toThrow();
  expect(await chess(page, (api) => ({ pgn: api.toPgn(), version: api.version() }))).toEqual(before);
  await chess(page, (api, portablePgn) => api.loadPgn(portablePgn, "portable-intent.pgn"), pgn);
  await waitForMetadata(page);
  expect(await chess(page, (api) => ({
    source: api.strategicFitMetadata().profile.source,
    provisional: api.strategicFitMetadata().profile.provisional,
  }))).toEqual({ source: "inferred", provisional: true });
});
