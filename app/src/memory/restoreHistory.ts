/**
 * OWNER: DHREY — task D3.2 (Restore History)
 *
 * Assembles the record of a context that has run: what it was, when it ran, which
 * capabilities it touched, and what those capabilities were set to BEFORE it touched
 * them. That last part is what restoration needs, and D3.1 already stores it.
 *
 *   context_session  ──1:1──  profile (mode/context name)
 *          │
 *          └──1:many──  device_snapshot  (capability + original value)
 *
 * STRICTLY READ-ONLY. Every function here SELECTs. Nothing writes, updates or deletes,
 * so no amount of history retrieval can disturb D3.1's first-write-wins snapshots —
 * reading the history a hundred times leaves the originals byte-identical.
 *
 * NO NEW TABLE AND NO MIGRATION. Everything below is derived from context_session,
 * context_profile and device_snapshot, which already carry every field D3.2 needs.
 *
 * RESTORATION VOCABULARY. This module does not invent one. `session.status` is the
 * frozen `SessionState` (types/policy.ts), which already includes RESTORING and PARTIAL
 * — the project's own restoration terms. The extra fields here are plain facts derived
 * from stored data (`ended`, `restorable`), not a competing status enum.
 */

import type { Capability, ContextProfile, ContextSession, DeviceSnapshot } from '../types';
import { profileRepository, sessionRepository, snapshotRepository } from './repositories';

/** One completed (or running) context, with everything restoration would need. */
export interface RestoreHistoryEntry {
  session: ContextSession;
  /**
   * The profile the session belonged to — this is where the mode/context NAME lives.
   * Null only if the profile row was deleted after the session ran.
   */
  profile: ContextProfile | null;
  /** Original pre-context values, oldest capture first. The D3.1 rows, unmodified. */
  snapshots: DeviceSnapshot[];
  /** Which capabilities this context touched, derived from the snapshots it captured. */
  capabilities: Capability[];
  /** endsAt − startedAt once ended; null while the context is still open. */
  durationMs: number | null;
  /** True once an end time was recorded. */
  ended: boolean;
  /**
   * Original values are still stored, so a restore is still possible.
   *
   * Goes false only when the snapshots have been cleaned up after a verified restore —
   * which is why cleanupSessionSnapshots must not be called until then (FLOW.md §6).
   */
  restorable: boolean;
}

function buildEntry(
  session: ContextSession,
  profile: ContextProfile | null,
  snapshots: DeviceSnapshot[],
): RestoreHistoryEntry {
  return {
    session,
    profile,
    snapshots,
    capabilities: snapshots.map((s) => s.capability),
    durationMs: session.endsAt === null ? null : session.endsAt - session.startedAt,
    ended: session.endsAt !== null,
    restorable: snapshots.length > 0,
  };
}

/**
 * The full historical record for one context.
 *
 * Returns null when the session id is unknown, rather than an empty shell that a caller
 * might mistake for a context that ran and changed nothing.
 */
export async function getRestoreHistory(sessionId: string): Promise<RestoreHistoryEntry | null> {
  const session = await sessionRepository.getById(sessionId);
  if (!session) {
    return null;
  }

  const [profile, snapshots] = await Promise.all([
    profileRepository.getProfileById(session.profileId),
    snapshotRepository.getBySession(session.id),
  ]);

  return buildEntry(session, profile, snapshots);
}

/**
 * Every context this profile has run, newest first.
 *
 * The profile is fetched once rather than per session — history lists grow, and the
 * mode name is the same for every row in them.
 */
export async function listRestoreHistory(profileId: string): Promise<RestoreHistoryEntry[]> {
  const [profile, sessions] = await Promise.all([
    profileRepository.getProfileById(profileId),
    sessionRepository.listForProfile(profileId),
  ]);

  const entries: RestoreHistoryEntry[] = [];
  for (const session of sessions) {
    const snapshots = await snapshotRepository.getBySession(session.id);
    entries.push(buildEntry(session, profile, snapshots));
  }
  return entries;
}

/**
 * Contexts that have finished, newest first.
 *
 * "Finished" means an end time has been recorded AND that time has passed — a session
 * with a planned end still in the future is running, not history. That is the same rule
 * sessionRepository.getActive() uses, kept consistent here so a session cannot be
 * reported as both active and completed.
 */
export async function listCompletedContexts(
  profileId: string,
  now: number = Date.now(),
): Promise<RestoreHistoryEntry[]> {
  const history = await listRestoreHistory(profileId);
  return history.filter((e) => e.session.endsAt !== null && e.session.endsAt <= now);
}

/**
 * Finished contexts whose original values are still on hand.
 *
 * This is the queue a restore pass would work through: everything that ended without
 * having its snapshots cleaned up is, by definition, not yet fully restored.
 */
export async function listRestorableContexts(
  profileId: string,
  now: number = Date.now(),
): Promise<RestoreHistoryEntry[]> {
  const completed = await listCompletedContexts(profileId, now);
  return completed.filter((e) => e.restorable);
}

/**
 * The original value one capability had before a given context changed it.
 *
 * A thin read over D3.1's per-capability lookup, so a caller asking "what was brightness
 * before this session?" does not have to load and filter the whole history.
 */
export async function getOriginalValue(
  sessionId: string,
  capability: Capability,
): Promise<DeviceSnapshot | null> {
  return snapshotRepository.getForCapability(sessionId, capability);
}
