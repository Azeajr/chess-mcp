/**
 * Minimal IndexedDB key-value store (no dependency). Used to persist the File System Access
 * FileHandle across sessions — handles are structured-cloneable, so they survive in IndexedDB.
 */
const DB_NAME = "chess-repertoire";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB database open failed"));
    };
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error("IndexedDB write failed"));
    };
  });
  db.close();
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      resolve(req.result as T | undefined);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB read failed"));
    };
  });
  db.close();
  return value;
}

export async function idbDel(key: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error("IndexedDB delete failed"));
    };
  });
  db.close();
}

export interface IdbAtomicMutation {
  readonly key: string;
  readonly value?: unknown;
  readonly delete?: boolean;
}

/** Commit related document records in one IndexedDB transaction. */
export async function idbMutateAtomically(mutations: readonly IdbAtomicMutation[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const mutation of mutations) {
      if (mutation.delete === true) store.delete(mutation.key);
      else store.put(mutation.value, mutation.key);
    }
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error("IndexedDB mutation failed"));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    };
  });
  db.close();
}
