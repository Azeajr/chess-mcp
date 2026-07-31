/**
 * Durable Strategic Fit job checkpoints for the browser.
 *
 * A reload is the interruption this exists for, so the record has to outlive the page. It reuses the
 * existing `chess-repertoire` IndexedDB key-value store rather than adding a database: the key
 * carries the format version, the record carries it again, and a record written by any other version
 * — or by a job whose document, revision, settings, or index generation no longer match — is deleted
 * on read instead of migrated or partially trusted.
 *
 * Only one checkpoint is kept. The Worker client is latest-request-wins, so a second job supersedes
 * the first, and keeping an unbounded history of large graph snapshots in user storage would be a
 * cost the user never asked for.
 */
import {
  strategicFitJobCheckpointRejection,
  type StrategicFitJobCheckpoint,
  type StrategicFitJobCheckpointRejection,
  type StrategicFitJobCompatibility,
} from "@chess-mcp/chess-tools";
import { idbDel, idbGet, idbSet } from "../store/idb";

/** Versioned key: a future format writes elsewhere and never reads this record. */
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
  /** Why the last stored checkpoint was refused, so a discard is observable rather than silent. */
  lastRejection(): StrategicFitJobCheckpointRejection | null;
  /** Why this host last dropped its own checkpoint: completion, cancellation, or failure. */
  lastDiscardReason(): string | null;
  /** Resolves once every queued write has been applied; tests and callers need a settled store. */
  settled(): Promise<void>;
}

const indexedDbPersistence: StrategicFitCheckpointPersistence = {
  read: (key) => idbGet<unknown>(key).then((value) => value ?? null),
  write: (key, value) => idbSet(key, value),
  remove: (key) => idbDel(key),
};

/**
 * Checkpoint writes are sequenced against each other so a save cannot land after the discard that
 * was meant to remove it. A storage failure — a quota refusal, a blocked database — leaves the job
 * unresumable, which is the safe direction, and never rejects the analysis that produced it.
 */
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
