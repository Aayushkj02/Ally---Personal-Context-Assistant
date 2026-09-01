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

  /**
   * Overrides in force for this profile right now.
   *
   * Active means the window is open: started, not yet expired, not deactivated.
   * The clock is injectable, like sessionRepository.getActive(now) and the policy
   * resolver, so expiry is testable at an exact instant rather than only "whenever
   * this ran". Expiry is decided per query — nothing is deleted and no timer runs, so
   * an app reopened hours later sees the correct answer immediately.
   */
  async getActiveForProfile(
    profileId: string,
    now: number = Date.now(),
  ): Promise<TemporaryOverride[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM temporary_override
         WHERE profileId = ?
           AND active = 1
           AND startAt <= ?
           AND expiresAt > ?`,
      [profileId, now, now],
    );
    return rows.map((row) => ({
      ...row,
      value: decodeValue(row.value),
      active: row.active === 1,
    }));
  },

  /** Every override ever recorded for a profile, newest first. History is retained. */
  async listForProfile(profileId: string): Promise<TemporaryOverride[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM temporary_override WHERE profileId = ? ORDER BY startAt DESC, rowid DESC`,
      [profileId],
    );
    return rows.map((row) => ({
      ...row,
      value: decodeValue(row.value),
      active: row.active === 1,
    }));
  },
  async identifyExpired(now: number = Date.now()): Promise<TemporaryOverride[]> {
    const db = await getDatabase();
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
