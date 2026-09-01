/**
 * OWNER: DHREY — task D-V2
 *
 * The only place priority preferences are read or written. Screens never touch SQL, and
 * they never keep their own copy — there is one storage model and this is it.
 *
 * Ported from feature/dhrey/priority-data-policy-ui and adapted to the D1 schema:
 * columns are camelCase like every other table, and the profile link is a real foreign
 * key so deleting a profile takes its priority list with it.
 */

import { CHANNEL_ENFORCEABLE } from '../../types';
import type { Channel, PriorityPreference } from '../../types';
import { getDatabase } from '../database';

/** SQLite has no boolean; enabled/enforceable round-trip as 0/1. */
interface Row {
  id: string;
  profileId: string;
  channel: string;
  subject: string;
  subjectKind: string;
  enabled: number;
  enforceable: number;
  sourceCommand: string | null;
  createdAt: number;
}

function toModel(r: Row): PriorityPreference {
  return {
    id: r.id,
    profileId: r.profileId,
    channel: r.channel as Channel,
    subject: r.subject,
    subjectKind: r.subjectKind === 'contactGroup' ? 'contactGroup' : 'contact',
    enabled: r.enabled === 1,
    enforceable: r.enforceable === 1,
    sourceCommand: r.sourceCommand,
    createdAt: r.createdAt,
  };
}

export const priorityRepository = {
  /** Every preference for one mode, ordered so the UI renders stably. */
  async listForProfile(profileId: string): Promise<PriorityPreference[]> {
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<Row>(
        `SELECT id, profileId, channel, subject, subjectKind, enabled, enforceable, sourceCommand, createdAt
           FROM priority_preference
          WHERE profileId = ?
          ORDER BY channel ASC, createdAt ASC`,
        [profileId],
      );
      return rows.map(toModel);
    } catch (e) {
      console.warn('Failed to read priority preferences:', e);
      return [];
    }
  },

  /**
   * Adds a subject to a mode's list, or re-enables it if it was already there.
   *
   * `enforceable` comes from CHANNEL_ENFORCEABLE rather than the caller, so a screen
   * cannot accidentally claim WhatsApp is enforced by passing the wrong flag (ADR-111).
   */
  async addPreference(input: {
    profileId: string;
    channel: Channel;
    subject: string;
    subjectKind?: 'contact' | 'contactGroup';
    sourceCommand?: string | null;
    now?: number;
  }): Promise<PriorityPreference> {
    try {
      const db = await getDatabase();
      const subject = input.subject.trim();
      if (!subject) {
        throw new Error('A priority contact needs a name.');
      }

      const now = input.now ?? Date.now();
      const id = `pp_${now.toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

      await db.runAsync(
        `INSERT INTO priority_preference
           (id, profileId, channel, subject, subjectKind, enabled, enforceable, sourceCommand, createdAt)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT (profileId, channel, subject)
           DO UPDATE SET enabled = 1`,
        [
          id,
          input.profileId,
          input.channel,
          subject,
          input.subjectKind ?? 'contact',
          CHANNEL_ENFORCEABLE[input.channel] ? 1 : 0,
          input.sourceCommand ?? null,
          now,
        ],
      );

      const row = await db.getFirstAsync<Row>(
        `SELECT id, profileId, channel, subject, subjectKind, enabled, enforceable, sourceCommand, createdAt
           FROM priority_preference
          WHERE profileId = ? AND channel = ? AND subject = ?`,
        [input.profileId, input.channel, subject],
      );
      if (!row) {
        throw new Error('Preference was not stored.');
      }
      return toModel(row);
    } catch (e) {
      throw new Error(`Persistence failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  },

  /** Toggles without deleting, so the user's list survives being turned off and on. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    try {
      const db = await getDatabase();
      await db.runAsync('UPDATE priority_preference SET enabled = ? WHERE id = ?', [
        enabled ? 1 : 0,
        id,
      ]);
    } catch (e) {
      throw new Error(`Persistence failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  },

  async removePreference(id: string): Promise<void> {
    try {
      const db = await getDatabase();
      await db.runAsync('DELETE FROM priority_preference WHERE id = ?', [id]);
    } catch (e) {
      throw new Error(`Persistence failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  },

  /** Wipes one mode's list. */
  async clearProfile(profileId: string): Promise<void> {
    try {
      const db = await getDatabase();
      await db.runAsync('DELETE FROM priority_preference WHERE profileId = ?', [profileId]);
    } catch (e) {
      throw new Error(`Persistence failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  },
};
