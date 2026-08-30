/**
 * OWNER: DHREY — task D1
 *
 * Ordered, forward-only migrations. One file per migration, named NNN_description.ts.
 * Never edit a migration that has already run on a teammate's device — add a new one.
 */

import * as SQLite from 'expo-sqlite';
import { up as initialSchema } from './001_initial_schema';
import { up as priorityPreference } from './002_priority_preference';

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt INTEGER NOT NULL
    );
  `);

  const appliedMigrations = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM migrations'
  );
  const appliedNames = new Set(appliedMigrations.map((m) => m.name));

  const migrations = [
    { name: '001_initial_schema', up: initialSchema },
    { name: '002_priority_preference', up: priorityPreference },
  ];

  for (const migration of migrations) {
    if (!appliedNames.has(migration.name)) {
      console.log(`Applying migration: ${migration.name}`);
      await migration.up(db);
      await db.runAsync(
        'INSERT INTO migrations (name, executedAt) VALUES (?, ?)',
        [migration.name, Date.now()]
      );
    }
  }
}
