/**
 * OWNER: DHREY — task D1, hardened in D3.1
 *
 * device_snapshot is the restoration source of truth (FLOW.md §6). It holds the value a
 * capability had BEFORE a context touched it, so "end study" can put the phone back.
 *
 * FIRST-WRITE-WINS (D3.1). Once a session has captured a capability, that row is the
 * original and nothing later may replace it. Every write path here uses
 * `ON CONFLICT (sessionId, capability) DO NOTHING`, backed by the unique index added in
 * migration 003, so the rule is enforced by the database rather than trusted to callers.
 *
 * Last-write-wins would be actively harmful: a second capture taken AFTER the context
 * already dimmed the screen would record 40% as the "original", and restoration would
 * then faithfully restore the wrong value.
 */

import { getDatabase } from '../database';
import type { Capability, CapabilityValue, DeviceSnapshot } from '../../types';

/**
 * Values round-trip through JSON, so a number stays a number and a string stays a
 * string. `null` is preserved as SQL NULL and means "we could not read this" — it is
 * never silently turned into a default (D3.1 requirement 11).
 */
function encodeValue(val: CapabilityValue | null): string | null {
  return val === null ? null : JSON.stringify(val);
}

function decodeValue(val: string | null): CapabilityValue | null {
  return val === null ? null : JSON.parse(val);
}

interface Row {
  id: string;
  sessionId: string;
  capability: string;
  previousValue: string | null;
  capturedAt: number;
}

function toModel(row: Row): DeviceSnapshot {
  return {
    id: row.id,
    sessionId: row.sessionId,
    capability: row.capability as Capability,
    previousValue: decodeValue(row.previousValue),
    capturedAt: row.capturedAt,
  };
}

const COLUMNS = 'id, sessionId, capability, previousValue, capturedAt';

export const snapshotRepository = {
  /**
   * Record the pre-context value for a capability.
   *
   * A second call for the same (sessionId, capability) is a no-op — the first row
   * stands. It neither throws nor duplicates, so a caller that re-runs is safe.
   */
  async create(snapshot: DeviceSnapshot): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO device_snapshot (${COLUMNS})
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (sessionId, capability) DO NOTHING`,
      [
        snapshot.id,
        snapshot.sessionId,
        snapshot.capability,
        encodeValue(snapshot.previousValue),
        snapshot.capturedAt,
      ],
    );
  },

  /**
   * Same write, but returns the row that is now authoritative for this capability —
   * the pre-existing original when one was already stored, otherwise the row just
   * written. Lets a caller see what restoration will actually use without a second read.
   */
  async captureOnce(snapshot: DeviceSnapshot): Promise<DeviceSnapshot> {
    await snapshotRepository.create(snapshot);

    const stored = await snapshotRepository.getForCapability(
      snapshot.sessionId,
      snapshot.capability,
    );
    if (!stored) {
      // Only reachable if the row vanished between write and read.
      throw new Error(
        `Snapshot for ${snapshot.capability} in session ${snapshot.sessionId} was not stored.`,
      );
    }
    return stored;
  },

  /** The authoritative original for one capability in one session, or null. */
  async getForCapability(
    sessionId: string,
    capability: Capability,
  ): Promise<DeviceSnapshot | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<Row>(
      `SELECT ${COLUMNS} FROM device_snapshot WHERE sessionId = ? AND capability = ?`,
      [sessionId, capability],
    );
    return row ? toModel(row) : null;
  },

  /** Everything captured for a session, oldest first — restoration reads this. */
  async getBySession(sessionId: string): Promise<DeviceSnapshot[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<Row>(
      `SELECT ${COLUMNS} FROM device_snapshot WHERE sessionId = ? ORDER BY capturedAt ASC, rowid ASC`,
      [sessionId],
    );
    return rows.map(toModel);
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM device_snapshot WHERE id = ?', [id]);
  },

  /**
   * Drop a session's snapshots. Call only AFTER a verified restore — while these rows
   * exist a partial restore is still recoverable (FLOW.md §6).
   */
  async cleanupSessionSnapshots(sessionId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM device_snapshot WHERE sessionId = ?', [sessionId]);
  },
};
