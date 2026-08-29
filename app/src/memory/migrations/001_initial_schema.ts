import * as SQLite from 'expo-sqlite';

export async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  // ContextProfile
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS context_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      modeKey TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `);

  // Preference
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS preference (
      id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      capability TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      sourceCommand TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (profileId) REFERENCES context_profile (id) ON DELETE CASCADE
    );
  `);

  // TemporaryOverride
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS temporary_override (
      id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      capability TEXT,
      value TEXT,
      subject TEXT,
      effect TEXT NOT NULL,
      startAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      active INTEGER NOT NULL,
      sourceCommand TEXT,
      FOREIGN KEY (profileId) REFERENCES context_profile (id) ON DELETE CASCADE
    );
  `);

  // ContextSession
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS context_session (
      id TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      startedAt INTEGER NOT NULL,
      endsAt INTEGER,
      status TEXT NOT NULL,
      FOREIGN KEY (profileId) REFERENCES context_profile (id) ON DELETE CASCADE
    );
  `);

  // DeviceSnapshot
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS device_snapshot (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      capability TEXT NOT NULL,
      previousValue TEXT,
      capturedAt INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES context_session (id) ON DELETE CASCADE
    );
  `);

  // CommandLog
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS command_log (
      id TEXT PRIMARY KEY,
      rawText TEXT NOT NULL,
      intentJson TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  // ActionExecution
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS action_execution (
      id TEXT PRIMARY KEY,
      commandId TEXT NOT NULL,
      capability TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      beforeValue TEXT,
      afterValue TEXT,
      FOREIGN KEY (commandId) REFERENCES command_log (id) ON DELETE CASCADE
    );
  `);

  // PermissionState
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS permission_state (
      key TEXT PRIMARY KEY,
      granted INTEGER NOT NULL,
      checkedAt INTEGER NOT NULL
    );
  `);
}
