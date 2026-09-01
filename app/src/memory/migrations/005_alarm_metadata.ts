import * as SQLite from 'expo-sqlite';

export async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS alarm_metadata (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      time TEXT NOT NULL,
      recurrence TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES context_session (id) ON DELETE CASCADE
    );
  `);
}
