/**
 * OWNER: DHREY
 *
 * Single SQLite connection, opened once and reused. Local-only: no cloud, no accounts,
 * no sync (PRD §21).
 */

import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { runMigrations } from '../migrations';

const DB_NAME = 'ally.db';

let dbPromise: Promise<SQLiteDatabase> | null = null;

/** Opens (once) and migrates. Safe to call from anywhere; later callers reuse the promise. */
export function getDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA foreign_keys = ON');
      await runMigrations(db);
      return db;
    })();
  }
  return dbPromise;
}

/** Test hook: drops the cached connection so a fresh one is opened next call. */
export function __resetDatabase(): void {
  dbPromise = null;
}
