/**
 * PGN open/save via the File System Access API (download/upload fallback). The FileHandle is kept
 * in a module variable so Save writes back to the same file, and persisted to IndexedDB so the
 * last file can be re-opened across sessions (auto-loaded when permission is still granted,
 * otherwise via a user-gesture "Reopen" button). Shared by TopBar + the Cmd/Ctrl+S shortcut.
 */
import { createSignal } from "solid-js";
import { actions, fileName } from "./game";
import type { Color } from "./game";
import { idbGet, idbSet, idbDel } from "./idb";
import { GameTree } from "@chess-mcp/chess-tools";
import { captureSnapshot } from "./persist";

type Perm = "granted" | "denied" | "prompt";
interface FilePickerHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(opts?: { mode?: string }): Promise<Perm>;
  requestPermission?(opts?: { mode?: string }): Promise<Perm>;
}
type PickerWindow = Window & {
  showOpenFilePicker?: (opts?: unknown) => Promise<FilePickerHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FilePickerHandle>;
};

const HANDLE_KEY = "fileHandle";
let handle: FilePickerHandle | null = null;
let reopenHandleForTesting: FilePickerHandle | null = null;
const PGN_TYPES = [{ description: "PGN", accept: { "application/x-chess-pgn": [".pgn"] } }];

// Name of a persisted handle that hasn't been (re-)opened yet → drives the TopBar "Reopen" button.
const [storedFileName, setStoredFileName] = createSignal<string | null>(null);
export { storedFileName };

export type DocumentCloseIntent = "new" | "open" | "reopen";

interface PendingDocumentClose {
  intent: DocumentCloseIntent;
  resume: () => void | Promise<void>;
}

const [pendingDocumentClose, setPendingDocumentClose] = createSignal<PendingDocumentClose | null>(
  null,
);
const [documentCloseError, setDocumentCloseError] = createSignal<string | null>(null);
const [savingDocumentClose, setSavingDocumentClose] = createSignal(false);
export { pendingDocumentClose, documentCloseError, savingDocumentClose };

interface FileNotice {
  message: string;
  action?: "open";
}

const [fileNotice, setFileNotice] = createSignal<FileNotice | null>(null);
export { fileNotice };

export function dismissFileNotice() {
  setFileNotice(null);
}

// Pending PGN load waiting for color selection.
interface PendingLoad {
  pgn: string;
  name?: string;
  detectedColor: Color | null;
  sourceHandle?: FilePickerHandle;
}
const [pendingLoad, setPendingLoad] = createSignal<PendingLoad | null>(null);
export { pendingLoad };

// Shown in the color-picker modal when the chosen file fails to parse (illegal SAN, no game) —
// GameTree.fromPgn throws, and without catching it the Load click died silently in the console.
const [loadError, setLoadError] = createSignal<string | null>(null);
export { loadError };

export function resolvePendingLoad(color: Color) {
  const p = pendingLoad();
  if (!p) return;
  try {
    actions.loadPgn(p.pgn, p.name);
  } catch (e) {
    setLoadError(e instanceof Error ? e.message : String(e));
    return; // keep the modal open so the error is visible; Cancel dismisses
  }
  actions.setColor(color);
  if (p.sourceHandle) remember(p.sourceHandle);
  setLoadError(null);
  setPendingLoad(null);
}

export function cancelPendingLoad() {
  setPendingLoad(null);
  setLoadError(null);
}

function remember(h: FilePickerHandle) {
  handle = h;
  void idbSet(HANDLE_KEY, h);
  setStoredFileName(null);
}

export function clearHandle() {
  handle = null;
  setStoredFileName(null);
  void idbDel(HANDLE_KEY);
}

/** DEV-only callers expose this through window.__chess for the denied-permission browser check. */
export function setReopenHandleForTesting(nextHandle: FilePickerHandle | null) {
  reopenHandleForTesting = nextHandle;
  setStoredFileName(nextHandle?.name ?? null);
}

/** Queue one document-replacing action until its consequence has been acknowledged. */
export function requestDocumentClose(
  intent: DocumentCloseIntent,
  resume: () => void | Promise<void>,
) {
  if (pendingDocumentClose()) return;
  setDocumentCloseError(null);
  setPendingDocumentClose({ intent, resume });
}

export function cancelDocumentClose() {
  setSavingDocumentClose(false);
  setDocumentCloseError(null);
  setPendingDocumentClose(null);
}

async function resumeDocumentClose(pending: PendingDocumentClose) {
  if (pendingDocumentClose() !== pending) return;
  setSavingDocumentClose(false);
  setDocumentCloseError(null);
  setPendingDocumentClose(null);
  await captureSnapshot("before-replace");
  await Promise.resolve(pending.resume()).catch((error: unknown) => {
    setFileNotice({
      message: `Could not continue: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
}

export async function continueDocumentClose(): Promise<void> {
  const pending = pendingDocumentClose();
  if (pending) await resumeDocumentClose(pending);
}

async function loadFromHandle(h: FilePickerHandle) {
  const pgn = await (await h.getFile()).text();
  setPendingLoad({
    pgn,
    name: h.name,
    detectedColor: GameTree.detectColorFromPgn(pgn),
    sourceHandle: h,
  });
}

function wasCancelled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function beginOpenFile() {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: PGN_TYPES });
      if (!h) return;
      await loadFromHandle(h);
    } catch (error) {
      if (!wasCancelled(error)) {
        setFileNotice({
          message: `Could not open a PGN: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pgn";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) {
      const pgn = await f.text();
      setPendingLoad({ pgn, name: f.name, detectedColor: GameTree.detectColorFromPgn(pgn) });
    }
  };
  input.click();
}

export function openFile() {
  requestDocumentClose("open", beginOpenFile);
}

export type SaveFileResult =
  | { via: "handle" | "picker" | "download"; fileName: string }
  | { via: "cancelled" }
  | { via: "failed"; message: string };

export async function saveFile(): Promise<SaveFileResult> {
  const pgn = actions.toPgn();
  const w = window as PickerWindow;
  try {
    if (handle) {
      const ws = await handle.createWritable();
      await ws.write(pgn);
      await ws.close();
      actions.markSaved();
      return { via: "handle", fileName: handle.name };
    }
    if (w.showSaveFilePicker) {
      const h = await w.showSaveFilePicker({ suggestedName: "repertoire.pgn", types: PGN_TYPES });
      remember(h);
      const ws = await h.createWritable();
      await ws.write(pgn);
      await ws.close();
      actions.markSaved();
      return { via: "picker", fileName: h.name };
    }
    const downloadedFileName = fileName() ?? "repertoire.pgn";
    const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = downloadedFileName;
    a.click();
    URL.revokeObjectURL(a.href);
    actions.markSaved();
    setFileNotice({
      message: `Downloaded ${downloadedFileName}. This browser cannot re-link that file for future saves.`,
    });
    return { via: "download", fileName: downloadedFileName };
  } catch (error) {
    if (wasCancelled(error)) return { via: "cancelled" };
    return {
      via: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveAndContinueDocumentClose() {
  const pending = pendingDocumentClose();
  if (!pending || savingDocumentClose()) return;
  setSavingDocumentClose(true);
  setDocumentCloseError(null);
  const result = await saveFile();
  if (pendingDocumentClose() !== pending) return;
  if (result.via === "cancelled") {
    setSavingDocumentClose(false);
    return;
  }
  if (result.via === "failed") {
    setSavingDocumentClose(false);
    setDocumentCloseError(`Could not save the file: ${result.message}`);
    return;
  }
  await resumeDocumentClose(pending);
}

/**
 * On startup: surface the last file as a "Reopen" affordance. We do NOT auto-load it — the
 * working repertoire is restored from autosave (store/persist), which holds the latest unsaved
 * edits; re-syncing to the on-disk file is an explicit user action (reopenLast).
 */
export async function restoreLastFile() {
  const h = await idbGet<FilePickerHandle>(HANDLE_KEY);
  if (h) setStoredFileName(h.name);
}

/** User-gesture re-open: request permission for the stored handle, then load it. */
export async function reopenLast() {
  const h = (await idbGet<FilePickerHandle>(HANDLE_KEY)) ?? reopenHandleForTesting;
  if (!h) return;
  requestDocumentClose("reopen", async () => {
    let perm = await h.queryPermission?.({ mode: "readwrite" });
    if (perm !== "granted") perm = await h.requestPermission?.({ mode: "readwrite" });
    if (perm !== "granted") {
      setFileNotice({
        message: `Permission to reopen ${h.name} was denied. Choose Open PGN to select it again.`,
        action: "open",
      });
      return;
    }
    await loadFromHandle(h);
  });
}
