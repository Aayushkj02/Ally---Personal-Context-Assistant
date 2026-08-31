import { getDatabase } from '../database';
import type { TemporaryOverride, Capability, CapabilityValue } from '../../types';

function encodeValue(val: CapabilityValue | null): string | null {
  return val === null ? null : JSON.stringify(val);
}

function decodeValue(val: string | null): CapabilityValue | null {
  return val === null ? null : JSON.parse(val);
}

export const overrideRepository = {
  async create(override: TemporaryOverride): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO temporary_override 
      (id, profileId, capability, value, subject, effect, startAt, expiresAt, active, sourceCommand) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        override.id,
        override.profileId,
        override.capability,
        encodeValue(override.value),
        override.subject,
        override.effect,
        override.startAt,
        override.expiresAt,
        override.active ? 1 : 0,
        override.sourceCommand,
      ],
    );
  },

  async getById(id: string): Promise<TemporaryOverride | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<any>('SELECT * FROM temporary_override WHERE id = ?', [id]);
    if (!row) return null;
    return {
      ...row,
      value: decodeValue(row.value),
      active: row.active === 1,
    };
  },

  async getActiveForProfile(profileId: string): Promise<TemporaryOverride[]> {
    const db = await getDatabase();
    const now = Date.now();
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM temporary_override 
       WHERE profileId = ? AND active = 1 AND expiresAt > ?`,
      [profileId, now],
    );
    return rows.map((row) => ({
      ...row,
      value: decodeValue(row.value),
      active: row.active === 1,
    }));
  },

  async identifyExpired(): Promise<TemporaryOverride[]> {
    const db = await getDatabase();
    const now = Date.now();
    const rows = await db.getAllAsync<any>(
      'SELECT * FROM temporary_override WHERE active = 1 AND expiresAt <= ?',
      [now],
    );
    return rows.map((row) => ({
      ...row,
      value: decodeValue(row.value),
      active: row.active === 1,
    }));
  },

  async markInactive(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE temporary_override SET active = 0 WHERE id = ?', [id]);
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM temporary_override WHERE id = ?', [id]);
  },
};
