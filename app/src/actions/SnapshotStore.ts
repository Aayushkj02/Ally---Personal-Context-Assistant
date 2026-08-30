/**
 * OWNER: AAYUSH — task A-V1
 *
 * The port through which the action engine records what a setting looked like BEFORE
 * Ally changed it.
 *
 * WHY A PORT AND NOT A DIRECT REPOSITORY CALL (ADR-114):
 * `device_snapshot` is Dhrey's table and `snapshotRepository` is his to write. The
 * executor is not allowed to touch SQLite, so it depends on this interface instead and
 * `snapshotStoreAdapter.ts` wires the real repository in from outside. The row shape is
 * the frozen `DeviceSnapshot` from src/types/models.ts — this file deliberately does NOT
 * define a second snapshot model, and there is no second persistence mechanism.
 *
 * FIRST WRITE WINS, per (sessionId, capability). This is not a tie-breaker. Re-snapshotting
 * a capability mid-session replaces the user's ORIGINAL value with one Ally itself set, and
 * restore then puts back Ally's own change. That is the bug ADR-110 records, expressed here
 * as a key collision so it cannot recur.
 */

import type { Capability, CapabilityValue, DeviceSnapshot } from '../types';

export interface SnapshotStore {
  /**
   * Records the pre-change value. Idempotent per (sessionId, capability): a second call
   * for the same pair MUST keep the first value and discard the new one.
   */
  save(snapshot: DeviceSnapshot): Promise<void>;
  /** Everything captured for a session, in capture order. Restore walks this in reverse. */
  forSession(sessionId: string): Promise<DeviceSnapshot[]>;
}

/** Stable id, which is what makes first-write-wins expressible as a plain key collision. */
export function snapshotId(sessionId: string, capability: Capability): string {
  return `${sessionId}:${capability}`;
}

export function buildSnapshot(
  sessionId: string,
  capability: Capability,
  previousValue: CapabilityValue | null,
  capturedAt: number,
): DeviceSnapshot {
  return {
    id: snapshotId(sessionId, capability),
    sessionId,
    capability,
    previousValue,
    capturedAt,
  };
}

/**
 * Process-lifetime store. This is what the executor's unit tests use, so they need no
 * database, and it is the safe default when no durable store is supplied.
 *
 * NOT a persistence mechanism for restore — `snapshotStoreAdapter.ts` is, backed by
 * Dhrey's repository. Restoration itself is A-V2/Phase 3 and is not claimed here.
 */
export function createInMemorySnapshotStore(): SnapshotStore {
  const rows = new Map<string, DeviceSnapshot>();

  return {
    async save(snapshot) {
      if (rows.has(snapshot.id)) return; // first write wins
      rows.set(snapshot.id, snapshot);
    },

    async forSession(sessionId) {
      return [...rows.values()].filter((r) => r.sessionId === sessionId);
    },
  };
}
