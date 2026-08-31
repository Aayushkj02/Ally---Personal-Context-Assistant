/**
 * OWNER: DHREY — task D1
 *
 * expo-sqlite connection + schema bootstrap. Local-only, no cloud, no accounts (PRD §21).
 * Table shapes are FROZEN in docs/CONTRACTS.md §5; row types in src/types/models.ts.
 */

import * as SQLite from 'expo-sqlite';
import { runMigrations } from '../migrations';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await SQLite.openDatabaseAsync('ally.db');
  await dbInstance.execAsync('PRAGMA foreign_keys = ON;');

  await runMigrations(dbInstance);

  return dbInstance;
}
