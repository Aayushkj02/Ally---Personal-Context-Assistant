import * as SQLite from 'expo-sqlite';

/**
 * A standing, mode-scoped decision about who may reach the user on a channel.
 *
 * Distinct from temporary_override, which expires. This is the durable priority list:
 * "during Sleep, Mom can call me."
 *
 * `enforceable` is denormalised from CHANNEL_ENFORCEABLE rather than derived at read
 * time, so a row always carries the promise that was made when it was written. If
 * Android ever opens up per-app bypass, old rows still say what was true of them.
 *
 * UNIQUE(profileId, channel, subject) makes writes idempotent: toggling Mom's calls off
 * and on again updates one row instead of accumulating duplicates.
 */
export async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS priority_preference (
      id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      channel TEXT NOT NULL,
      subject TEXT NOT NULL,
      subjectKind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      enforceable INTEGER NOT NULL DEFAULT 0,
      sourceCommand TEXT,
      createdAt INTEGER NOT NULL,
      UNIQUE (profileId, channel, subject),
      FOREIGN KEY (profileId) REFERENCES context_profile (id) ON DELETE CASCADE
    );
  `);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_priority_profile_channel
      ON priority_preference (profileId, channel);
  `);
}
