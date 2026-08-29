/**
 * OWNER: DHREY
 *
 * Forward-only, ordered migrations. Never edit one that has already run on a teammate's
 * device — add a new one. `user_version` is how SQLite tracks which have been applied.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

interface Migration {
  version: number;
  name: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'priority_preference',
    /**
     * A standing, mode-scoped decision about who may reach the user on a channel.
     *
     * `enforceable` is denormalised from CHANNEL_ENFORCEABLE rather than derived at read
     * time, so a row always carries the promise that was made when it was written. If
     * Android ever opens up per-app bypass, old rows still say what was true of them.
     *
     * UNIQUE(profile_id, channel, subject) makes the row idempotent: toggling Mom's calls
     * off and on again updates one row instead of accumulating duplicates.
     */
    up: `
      CREATE TABLE IF NOT EXISTS priority_preference (
        id            TEXT PRIMARY KEY NOT NULL,
        profile_id    TEXT NOT NULL,
        channel       TEXT NOT NULL,
        subject       TEXT NOT NULL,
        subject_kind  TEXT NOT NULL,
        enabled       INTEGER NOT NULL DEFAULT 1,
        enforceable   INTEGER NOT NULL DEFAULT 0,
        source_command TEXT,
        created_at    INTEGER NOT NULL,
        UNIQUE(profile_id, channel, subject)
      );
      CREATE INDEX IF NOT EXISTS idx_priority_profile_channel
        ON priority_preference(profile_id, channel);
    `,
  },
];

export async function runMigrations(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.execAsync(m.up);
    await db.execAsync(`PRAGMA user_version = ${m.version}`);
    current = m.version;
  }
  return current;
}

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
