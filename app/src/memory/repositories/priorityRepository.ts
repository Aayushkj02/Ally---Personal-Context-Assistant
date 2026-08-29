/**
 * OWNER: DHREY
 *
 * The only place priority preferences are read or written. Screens never touch SQL, and
 * they never keep their own copy — there is one storage model and this is it.
 */

import type { Channel, PriorityPreference } from '../../types';
import { CHANNEL_ENFORCEABLE } from '../../types';
import { getDatabase } from '../database';

interface Row {
  id: string;
  profile_id: string;
  channel: string;
  subject: string;
  subject_kind: string;
  enabled: number;
  enforceable: number;
  source_command: string | null;
  created_at: number;
}

function toModel(r: Row): PriorityPreference {
  return {
    id: r.id,
    profileId: r.profile_id,
    channel: r.channel as Channel,
    subject: r.subject,
    subjectKind: r.subject_kind === 'contactGroup' ? 'contactGroup' : 'contact',
    enabled: r.enabled === 1,
    enforceable: r.enforceable === 1,
    sourceCommand: r.source_command,
    createdAt: r.created_at,
  };
}

/** Every preference for one mode, ordered so the UI renders stably. */
export async function listForProfile(profileId: string): Promise<PriorityPreference[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM priority_preference WHERE profile_id = ?
     ORDER BY channel ASC, created_at ASC`,
    [profileId],
  );
  return rows.map(toModel);
}

/**
 * Adds a subject to a mode's list, or re-enables it if it was already there.
 *
 * `enforceable` comes from CHANNEL_ENFORCEABLE rather than the caller, so a screen cannot
 * accidentally claim WhatsApp is enforced by passing the wrong flag (ADR-111).
 */
export async function addPreference(input: {
  profileId: string;
  channel: Channel;
  subject: string;
  subjectKind?: 'contact' | 'contactGroup';
  sourceCommand?: string | null;
}): Promise<PriorityPreference> {
  const db = await getDatabase();
  const subject = input.subject.trim();
  if (!subject) throw new Error('A priority contact needs a name.');

  const now = Date.now();
  const id = `pp_${input.profileId}_${input.channel}_${now}_${Math.random().toString(36).slice(2, 7)}`;

  await db.runAsync(
    `INSERT INTO priority_preference
       (id, profile_id, channel, subject, subject_kind, enabled, enforceable, source_command, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(profile_id, channel, subject)
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
    `SELECT * FROM priority_preference WHERE profile_id = ? AND channel = ? AND subject = ?`,
    [input.profileId, input.channel, subject],
  );
  if (!row) throw new Error('Preference was not stored.');
  return toModel(row);
}

/** Toggles without deleting, so the user's list survives being turned off and on. */
export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE priority_preference SET enabled = ? WHERE id = ?`, [
    enabled ? 1 : 0,
    id,
  ]);
}

export async function removePreference(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM priority_preference WHERE id = ?`, [id]);
}

/** Test/demo helper: wipes one mode's list. */
export async function clearProfile(profileId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM priority_preference WHERE profile_id = ?`, [profileId]);
}
