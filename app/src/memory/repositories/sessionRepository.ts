import { getDatabase } from '../database';
import type { ContextSession, SessionState } from '../../types';

export const sessionRepository = {
  async create(session: ContextSession): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO context_session (id, profileId, startedAt, endsAt, status) VALUES (?, ?, ?, ?, ?)',
      [session.id, session.profileId, session.startedAt, session.endsAt, session.status],
    );
  },

  async getById(id: string): Promise<ContextSession | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContextSession>(
      'SELECT id, profileId, startedAt, endsAt, status FROM context_session WHERE id = ?',
      [id],
    );
    return row || null;
  },

  /**
   * The session that is running right now, or null.
   *
   * A session is open while it has no end time OR its end time is still in the future.
   * The earlier `endsAt IS NULL` test missed every duration-bounded session — a two-hour
   * study context sets endsAt at creation, so it was never reported as active (D-V7).
   */
  async getActive(now: number = Date.now()): Promise<ContextSession | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContextSession>(
      `SELECT id, profileId, startedAt, endsAt, status FROM context_session
        WHERE (endsAt IS NULL OR endsAt > ?)
          AND status NOT IN ('IDLE', 'ERROR')
        ORDER BY startedAt DESC, rowid DESC LIMIT 1`,
      [now],
    );
    return row || null;
  },

  /** Same, scoped to one context. */
  async getActiveForProfile(
    profileId: string,
    now: number = Date.now(),
  ): Promise<ContextSession | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContextSession>(
      `SELECT id, profileId, startedAt, endsAt, status FROM context_session
        WHERE profileId = ?
          AND (endsAt IS NULL OR endsAt > ?)
          AND status NOT IN ('IDLE', 'ERROR')
        ORDER BY startedAt DESC, rowid DESC LIMIT 1`,
      [profileId, now],
    );
    return row || null;
  },

  /** Full history for one context, newest first. Ended sessions are never deleted. */
  async listForProfile(profileId: string): Promise<ContextSession[]> {
    const db = await getDatabase();
    return await db.getAllAsync<ContextSession>(
      `SELECT id, profileId, startedAt, endsAt, status FROM context_session
        WHERE profileId = ? ORDER BY startedAt DESC, rowid DESC`,
      [profileId],
    );
  },
  async update(session: ContextSession): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE context_session SET endsAt = ?, status = ? WHERE id = ?', [
      session.endsAt,
      session.status,
      session.id,
    ]);
  },

  async endSession(id: string, status: SessionState, endsAt: number): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('UPDATE context_session SET endsAt = ?, status = ? WHERE id = ?', [
      endsAt,
      status,
      id,
    ]);
  },
};
