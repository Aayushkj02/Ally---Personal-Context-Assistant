import * as SQLite from 'expo-sqlite';

/**
 * D3.1 — make a session's snapshot of a capability unique, so the ORIGINAL value wins.
 *
 * `device_snapshot` had no uniqueness on (sessionId, capability), so calling create()
 * twice for the same capability in one session stored two rows. Restoration would then
 * have two competing "original" values and pick whichever `ORDER BY capturedAt ASC`
 * happened to return first — which is undefined when both were captured in the same
 * millisecond. The pre-context value is the one thing restoration cannot get wrong.
 *
 * Additive and non-destructive to the schema: 001 is untouched, no column is dropped or
 * retyped. The one deletion is de-duplication, and it keeps the EARLIEST row per
 * (sessionId, capability) — the true original — discarding only later re-captures that
 * should never have been written. Without that step the index could not be created on a
 * database that already contains duplicates.
 */
export async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  // Keep the earliest capture per (sessionId, capability); drop any row that has an
  // earlier sibling. Written without window functions or DELETE aliases so it runs on
  // the oldest SQLite either expo-sqlite or better-sqlite3 might supply.
  await db.execAsync(`
    DELETE FROM device_snapshot
    WHERE EXISTS (
      SELECT 1 FROM device_snapshot AS earlier
      WHERE earlier.sessionId = device_snapshot.sessionId
        AND earlier.capability = device_snapshot.capability
        AND (
          earlier.capturedAt < device_snapshot.capturedAt
          OR (
            earlier.capturedAt = device_snapshot.capturedAt
            AND earlier.rowid < device_snapshot.rowid
          )
        )
    );
  `);

  // The conflict target that makes first-write-wins enforceable in the database rather
  // than merely intended in the repository.
  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_session_capability
      ON device_snapshot (sessionId, capability);
  `);
}
