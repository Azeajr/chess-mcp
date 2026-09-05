import {
  strategicFitJobCheckpointRejection,
  type StrategicFitJobCheckpoint,
  type StrategicFitJobCheckpointRejection,
  type StrategicFitJobCompatibility,
} from "@chess-mcp/chess-tools";
import { idbDel, idbGet, idbSet } from "../store/idb";

export const STRATEGIC_FIT_CHECKPOINT_KEY = "strategic-fit:job-checkpoint:v1";

export interface StrategicFitCheckpointPersistence {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StrategicFitCheckpointPort {
  load(compatibility: StrategicFitJobCompatibility): Promise<StrategicFitJobCheckpoint | null>;
  save(checkpoint: StrategicFitJobCheckpoint): void;
  discard(reason: string): void;
  lastRejection(): StrategicFitJobCheckpointRejection | null;
  lastDiscardReason(): string | null;
  settled(): Promise<void>;
}

const indexedDbPersistence: StrategicFitCheckpointPersistence = {
  read: (key) => idbGet<unknown>(key).then((value) => value ?? null),
  write: (key, value) => idbSet(key, value),
  remove: (key) => idbDel(key),
};

export function createStrategicFitCheckpointPort(
  persistence: StrategicFitCheckpointPersistence = indexedDbPersistence,
  key: string = STRATEGIC_FIT_CHECKPOINT_KEY,
): StrategicFitCheckpointPort {
  let queue: Promise<void> = Promise.resolve();
  let rejection: StrategicFitJobCheckpointRejection | null = null;
  let discardReason: string | null = null;

  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work, work).catch(() => undefined);
  };

  return {
    async load(compatibility) {
      await queue;
      let stored: unknown;
      try {
        stored = await persistence.read(key);
      } catch {
        rejection = {
          code: "strategic_fit_checkpoint_unreadable",
          reason: "The stored Strategic Fit checkpoint could not be read.",
        };
        return null;
      }
      if (stored === null || stored === undefined) {
        rejection = null;
        return null;
      }
      const refused = strategicFitJobCheckpointRejection(stored, compatibility);
      if (refused !== null) {
        rejection = refused;
        enqueue(() => persistence.remove(key));
        return null;
      }
      rejection = null;
      return stored as StrategicFitJobCheckpoint;
    },
    save(checkpoint) {
      enqueue(() => persistence.write(key, checkpoint));
    },
    discard(reason) {
      discardReason = reason;
      enqueue(() => persistence.remove(key));
    },
    lastRejection: () => rejection,
    lastDiscardReason: () => discardReason,
    settled: () => queue,
  };
}
