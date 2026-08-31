import * as SQLite from 'expo-sqlite';

/**
 * D4.1 — enforce UNIQUE(profileId, capability) on the preference table.
 *
 * Before this migration, multiple preferences could be taught and persisted
 * for the same capability within a single profile, leading to indeterminate
 * policy resolution based on SQLite's implicit row ordering.
 *
 * This migration enforces LAST-WRITE-WINS semantics (D4.1 requirement).
 * It deduplicates any existing rows by keeping the most recently created row
 * (newest createdAt). If timestamps are identical, rowid is used as a deterministic tie-breaker.
 */
export async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  // Deduplicate existing records: Keep the most recent record per (profileId, capability).
  await db.execAsync(`
    DELETE FROM preference
    WHERE EXISTS (
      SELECT 1 FROM preference AS newer
      WHERE newer.profileId = preference.profileId
        AND newer.capability = preference.capability
        AND (
          newer.createdAt > preference.createdAt
          OR (
            newer.createdAt = preference.createdAt
            AND newer.rowid > preference.rowid
          )
        )
    );
  `);

  // Enforce uniqueness at the database level for deterministic upserts going forward.
  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preference_profile_capability
      ON preference (profileId, capability);
  `);
}
