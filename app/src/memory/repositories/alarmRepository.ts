import { getDatabase } from '../database';

export interface AlarmMetadata {
  id: string;
  sessionId: string;
  time: string;
  recurrence: string;
  createdAt: number;
}

const COLUMNS = 'id, sessionId, time, recurrence, createdAt';

export const alarmRepository = {
  async createAlarmMetadata(alarm: AlarmMetadata): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO alarm_metadata (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`,
      [alarm.id, alarm.sessionId, alarm.time, alarm.recurrence, alarm.createdAt],
    );
  },

  async getAlarmMetadataBySession(sessionId: string): Promise<AlarmMetadata[]> {
    const db = await getDatabase();
    return db.getAllAsync<AlarmMetadata>(
      `SELECT ${COLUMNS} FROM alarm_metadata WHERE sessionId = ? ORDER BY createdAt ASC`,
      [sessionId],
    );
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM alarm_metadata WHERE id = ?', [id]);
  },
};
