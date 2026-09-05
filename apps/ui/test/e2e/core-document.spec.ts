import { expect, test, type Page } from "playwright/test";
import { currentPgn, openApp } from "./helpers/app";
import { basicAccessibilityViolations } from "./helpers/accessibility";

type ChessHarness = {
  applyEdit(
    action: "add" | "prune" | "reorder",
    path: string[],
    options?: { addMoves?: string[]; promoteMove?: string },
  ): { ok: boolean };
};

const documentCloseDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Replace current repertoire?" });

async function makeDocumentDirty(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __chess: ChessHarness }).__chess.applyEdit("add", ["d4", "Nf6"], {
      addMoves: ["Nf3"],
    }),
  );
}

test("WP-003 AC-1 AC-5 AC-8 guards a clean New without changing the document", async ({ page }) => {
  await openApp(page);
  const before = await currentPgn(page);
  const newButton = page.getByRole("button", { name: "New" });
  await newButton.focus();
  await newButton.click();

  const dialog = documentCloseDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("rich-repertoire.pgn");
  await expect(dialog.getByText("There are no unexported changes.")).toBeVisible();
  await expect(page.locator(".app-main")).toHaveJSProperty("inert", true);
  expect(await basicAccessibilityViolations(dialog)).toEqual([]);
  expect(await currentPgn(page)).toBe(before);

  const pathBefore = await page.evaluate(() =>
    (window as unknown as { __chess: { currentPath(): number[] } }).__chess.currentPath(),
  );
  await page.keyboard.press("ArrowRight");
  expect(
    await page.evaluate(() =>
      (window as unknown as { __chess: { currentPath(): number[] } }).__chess.currentPath(),
    ),
  ).toEqual(pathBefore);

  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const continueButton = dialog.getByRole("button", { name: "Continue" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(continueButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(dialog).toHaveCount(0);
  await expect(newButton).toBeFocused();
  expect(await currentPgn(page)).toBe(before);
});

test("WP-003 AC-2 AC-3 saves unexported work before starting a new document", async ({ page }) => {
  await openApp(page);
  expect(await makeDocumentDirty(page)).toMatchObject({ ok: true });
  const changed = await currentPgn(page);
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        name: "saved-repertoire.pgn",
        createWritable: async () => ({
          write: async (pgn: string) => {
            (window as unknown as { __wp003Writes: string[] }).__wp003Writes.push(pgn);
          },
          close: async () => undefined,
        }),
      }),
    });
    (window as unknown as { __wp003Writes: string[] }).__wp003Writes = [];
  });

  await page.getByRole("button", { name: "New" }).click();
  const dialog = documentCloseDialog(page);
  await expect(dialog).toContainText("rich-repertoire.pgn has 1 unexported change.");
  await expect(dialog.getByRole("button", { name: "Keep working" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save to file first" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Discard and start new" })).toBeVisible();

  await dialog.getByRole("button", { name: "Save to file first" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __wp003Writes: string[] }).__wp003Writes),
    )
    .toEqual([changed]);
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => currentPgn(page)).not.toBe(changed);
});

test("WP-003 AC-3 leaves the document and guard in place when saving is cancelled", async ({
  page,
}) => {
  await openApp(page);
  expect(await makeDocumentDirty(page)).toMatchObject({ ok: true });
  const changed = await currentPgn(page);
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      },
    });
  });

  await page.getByRole("button", { name: "New" }).click();
  const dialog = documentCloseDialog(page);
  await dialog.getByRole("button", { name: "Save to file first" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save to file first" })).toBeEnabled();
  expect(await currentPgn(page)).toBe(changed);
  await dialog.getByRole("button", { name: "Keep working" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await currentPgn(page)).toBe(changed);
});

test("WP-003 AC-4 guards Open PGN before the picker and preserves the colour picker flow", async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() => {
    let pickerCalls = 0;
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => {
        pickerCalls += 1;
        return [
          {
            name: "candidate.pgn",
            getFile: async () => new File(["1. d4 d5 *"], "candidate.pgn"),
          },
        ];
      },
    });
    (window as unknown as { __wp003PickerCalls: () => number }).__wp003PickerCalls = () =>
      pickerCalls;
  });

  await page.getByRole("button", { name: "Open PGN" }).click();
  const dialog = documentCloseDialog(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __wp003PickerCalls: () => number }).__wp003PickerCalls(),
      ),
    )
    .toBe(0);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __wp003PickerCalls: () => number }).__wp003PickerCalls(),
      ),
    )
    .toBe(1);
  await expect(
    page.getByRole("dialog", { name: "Which color is this repertoire for?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("WP-003 AC-4 AC-7 guards Reopen and offers Open PGN after permission is denied", async ({
  page,
}) => {
  await openApp(page);
  const before = await currentPgn(page);
  await page.evaluate(() => {
    (
      window as unknown as {
        __chess: {
          setReopenHandleForTesting(handle: unknown): void;
        };
      }
    ).__chess.setReopenHandleForTesting({
      name: "denied-repertoire.pgn",
      queryPermission: async () => "denied",
      requestPermission: async () => "denied",
    });
  });

  await page.getByRole("button", { name: "Reopen denied-repertoire.pgn" }).click();
  const dialog = documentCloseDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();

  const notice = page.locator(".file-notice");
  await expect(notice).toContainText(
    "Permission to reopen denied-repertoire.pgn was denied. Choose Open PGN",
  );
  await expect(notice.getByRole("button", { name: "Open PGN" })).toBeVisible();
  expect(await currentPgn(page)).toBe(before);
});

test("WP-003 AC-6 names the downloaded file when save cannot re-link it", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("rich-repertoire.pgn");
  await expect(page.locator(".file-notice")).toContainText(
    "Downloaded rich-repertoire.pgn. This browser cannot re-link that file for future saves.",
  );
});

test("WP-004 AC-1 AC-2 recovers a replaced document as a new identity", async ({ page }) => {
  await openApp(page);
  const before = await currentPgn(page);
  const beforeId = await page.evaluate(() =>
    (window as unknown as { __chess: { documentId(): string } }).__chess.documentId(),
  );

  await page.getByRole("button", { name: "New" }).click();
  const guard = documentCloseDialog(page);
  await expect(guard.getByRole("button", { name: "Recover an earlier repertoire" })).toBeVisible();
  await guard.getByRole("button", { name: "Continue" }).click();
  await expect(guard).toHaveCount(0);
  await expect.poll(() => currentPgn(page)).not.toBe(before);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Recover a repertoire" }).click();
  const recover = page.getByRole("dialog", { name: "Recover a repertoire" });
  await expect(recover).toBeVisible();

  const row = recover.locator(".recover-item", { hasText: "rich-repertoire.pgn" });
  await expect(row).toHaveCount(1);
  const metadata = (await row.locator("small").innerText()).split(" · ");
  expect(metadata).toHaveLength(4);
  expect(Number.isFinite(Date.parse(metadata[0]!))).toBe(true);
  expect(metadata[1]).toMatch(/^\d+(\.\d+)? (B|KB|MB)$/);
  expect(metadata[2]).toMatch(/^\d+ moves$/);
  expect(metadata[3]).toMatch(/^\d+ lines$/);
  await expect(recover.getByLabel("Snapshot PGN preview")).toContainText("1. d4 Nf6");
  expect(await basicAccessibilityViolations(recover)).toEqual([]);

  await recover.getByRole("button", { name: "Restore as new document" }).click();
  await expect(recover).toHaveCount(0);
  expect(await currentPgn(page)).toBe(before);
  expect(
    await page.evaluate(() =>
      (window as unknown as { __chess: { documentId(): string } }).__chess.documentId(),
    ),
  ).not.toBe(beforeId);
});

test("UX-005 mutation application, undo, and redo preserve exact PGN", async ({ page }) => {
  await openApp(page, { pgn: `[Result "*"]\n\n1. d4 d5 *\n` });
  const original = await currentPgn(page);
  const mutation = await page.evaluate(() => {
    const chess = (
      window as unknown as {
        __chess: {
          applyEdit(
            action: "add",
            path: string[],
            options: { addMoves: string[] },
          ): { ok: boolean };
        };
      }
    ).__chess;
    return chess.applyEdit("add", ["d4"], { addMoves: ["e6"] });
  });
  expect(mutation).toMatchObject({ ok: true });
  const mutated = await currentPgn(page);
  expect(mutated).not.toBe(original);

  await page.keyboard.press("Control+z");
  expect(await currentPgn(page)).toBe(original);
  await page.keyboard.press("Control+Shift+z");
  expect(await currentPgn(page)).toBe(mutated);
  await page.keyboard.press("Control+z");
  expect(await currentPgn(page)).toBe(original);
  await page.keyboard.press("Control+Shift+z");
  expect(await currentPgn(page)).toBe(mutated);
});
