/**
 * OWNER: AAYUSH — task A-V1
 *
 * Wires the `SnapshotStore` port to Dhrey's EXISTING `snapshotRepository`. This is the
 * only file in the action engine that knows a database exists, and it is deliberately not
 * imported by `executors/index.ts` — the executor depends on the interface alone, so it
 * stays DB-free and unit-testable in Node (ADR-114).
 *
 * It creates no schema, no table and no second persistence mechanism. `device_snapshot`
 * and its repository are Dhrey's and are used exactly as published.
 *
 * FIRST WRITE WINS is enforced here the same way the in-memory store enforces it. The row
 * id is `sessionId:capability`, which is the table's PRIMARY KEY, so a second capture for
 * the same pair is a key collision rather than an overwrite — restore must always target
 * the value from before Ally arrived, never one Ally itself set (ADR-110).
 */

import { snapshotRepository } from '../memory';
import type { DeviceSnapshot } from '../types';
import type { SnapshotStore } from './SnapshotStore';

export function createRepositorySnapshotStore(): SnapshotStore {
  return {
    async save(snapshot: DeviceSnapshot) {
      // Read-then-write rather than relying on the INSERT to throw: the driver's error
      // shape is not part of the repository's published contract, so matching on it
      // would couple the action engine to an implementation detail of Dhrey's layer.
      const existing = await snapshotRepository.getBySession(snapshot.sessionId);
      if (existing.some((row) => row.id === snapshot.id)) return;

      await snapshotRepository.create(snapshot);
    },

    async forSession(sessionId: string) {
      return snapshotRepository.getBySession(sessionId);
    },
  };
}
