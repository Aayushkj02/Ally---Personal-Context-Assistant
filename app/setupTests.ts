import Database from 'better-sqlite3';

class MockSQLiteDatabase {
  db: any;

  constructor(name: string) {
    this.db = new Database(':memory:');
  }

  async execAsync(source: string): Promise<void> {
    this.db.exec(source);
  }

  async runAsync(source: string, args: any[] = []): Promise<any> {
    const info = this.db.prepare(source).run(...args);
    return { lastInsertRowId: info.lastInsertRowid, changes: info.changes };
  }

  async getFirstAsync<T>(source: string, args: any[] = []): Promise<T | null> {
    const row = this.db.prepare(source).get(...args);
    return (row as T) || null;
  }

  async getAllAsync<T>(source: string, args: any[] = []): Promise<T[]> {
    const rows = this.db.prepare(source).all(...args);
    return (rows as T[]) || [];
  }
}

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockImplementation(async (name) => {
    return new MockSQLiteDatabase(name);
  }),
}));
