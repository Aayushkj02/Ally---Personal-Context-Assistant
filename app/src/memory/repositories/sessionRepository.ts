import { getDatabase } from '../database';
import type { ContextSession, SessionState } from '../../types';

export const sessionRepository = {
  async create(session: ContextSession): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO context_session (id, profileId, startedAt, endsAt, status) VALUES (?, ?, ?, ?, ?)',
      [session.id, session.profileId, session.startedAt, session.endsAt, session.status]
    );
  },

  async getById(id: string): Promise<ContextSession | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContextSession>(
      'SELECT id, profileId, startedAt, endsAt, status FROM context_session WHERE id = ?',
      [id]
    );
    return row || null;
  },

  async getActive(): Promise<ContextSession | null> {
    const db = await getDatabase();
    // Assuming status != 'IDLE' and != 'ERROR' means active? Or just sort by startedAt?
    // According to PRD, session represents current context. Let's find latest open session.
    // We can just rely on the 'endsAt IS NULL' or 'status' for active sessions.
    const row = await db.getFirstAsync<ContextSession>(
      "SELECT id, profileId, startedAt, endsAt, status FROM context_session WHERE endsAt IS NULL AND status NOT IN ('IDLE', 'ERROR') ORDER BY startedAt DESC LIMIT 1"
    );
    return row || null;
  },

  async update(session: ContextSession): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE context_session SET endsAt = ?, status = ? WHERE id = ?',
      [session.endsAt, session.status, session.id]
    );
  },

  async endSession(id: string, status: SessionState, endsAt: number): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE context_session SET endsAt = ?, status = ? WHERE id = ?',
      [endsAt, status, id]
    );
  }
};
