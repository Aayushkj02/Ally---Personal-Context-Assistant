import { getDatabase } from '../database';
import type { PermissionState } from '../../types';

export const permissionRepository = {
  async save(state: PermissionState): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO permission_state (key, granted, checkedAt) 
       VALUES (?, ?, ?) 
       ON CONFLICT(key) DO UPDATE SET 
       granted = excluded.granted, 
       checkedAt = excluded.checkedAt`,
      [state.key, state.granted ? 1 : 0, state.checkedAt]
    );
  },

  async getByKey(key: string): Promise<PermissionState | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<any>(
      'SELECT * FROM permission_state WHERE key = ?',
      [key]
    );
    if (!row) return null;
    return {
      ...row,
      granted: row.granted === 1
    };
  }
};
