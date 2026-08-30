import { getDatabase } from '../database';
import type { DeviceSnapshot, CapabilityValue } from '../../types';

function encodeValue(val: CapabilityValue | null): string | null {
  return val === null ? null : JSON.stringify(val);
}

function decodeValue(val: string | null): CapabilityValue | null {
  return val === null ? null : JSON.parse(val);
}

export const snapshotRepository = {
  async create(snapshot: DeviceSnapshot): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO device_snapshot (id, sessionId, capability, previousValue, capturedAt) VALUES (?, ?, ?, ?, ?)',
      [snapshot.id, snapshot.sessionId, snapshot.capability, encodeValue(snapshot.previousValue), snapshot.capturedAt]
    );
  },

  async getBySession(sessionId: string): Promise<DeviceSnapshot[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>(
      'SELECT * FROM device_snapshot WHERE sessionId = ? ORDER BY capturedAt ASC',
      [sessionId]
    );
    return rows.map(row => ({
      ...row,
      previousValue: decodeValue(row.previousValue)
    }));
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM device_snapshot WHERE id = ?', [id]);
  },

  async cleanupSessionSnapshots(sessionId: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM device_snapshot WHERE sessionId = ?', [sessionId]);
  }
};
