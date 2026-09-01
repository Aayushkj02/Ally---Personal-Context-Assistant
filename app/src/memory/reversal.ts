/**
 * OWNER: DHREY — task D3.3 (Undo / Reversal)
 *
 * Decides WHICH context "undo that" refers to, and WHAT the original values were.
 * It does not touch the device — producing the plan is policy's job and executing it
 * is Aayush's (FLOW.md §5, §6).
 *
 *   "undo that" → most recently FINISHED reversible context (D3.2 history)
 *               → its snapshots (D3.1, first-write-wins originals)
 *               → RestorationTarget
 *
 * DETERMINISTIC BY CONSTRUCTION. Selection is a sort over stored timestamps. No model
 * is consulted and no semantic guessing happens: the session table already knows which
 * context ended last, so asking an LLM would add a failure mode and answer no question
 * the database cannot.
 *
 * READ-ONLY, like D3.2. Nothing here writes, so no reversal lookup can disturb the
 * first-write-wins originals it is reading.
 */

import type { ContextProfile, ContextSession, DeviceSnapshot } from '../types';
import { listRestorableContexts, type RestoreHistoryEntry } from './restoreHistory';
import { profileRepository, sessionRepository, snapshotRepository } from './repositories';

/**
 * What a restore would put back.
 *
 * `restorable` and `unavailable` are kept apart on purpose. A snapshot whose
 * previousValue is null means "we could not read this before we changed it" — there is
 * no honest value to restore, and inventing 0 or 'off' would set the phone to something
 * the user never had. Those rows are reported, never guessed at.
 */
export interface RestorationTarget {
  session: ContextSession;
  profile: ContextProfile | null;
  /** Originals with a known value. These are what a restore acts on. */
  restorable: DeviceSnapshot[];
  /** Captured, but the original could not be read. Reported, never defaulted. */
  unavailable: DeviceSnapshot[];
}

/** Most recently FINISHED first — endsAt is when the context the user means ended. */
function byMostRecentlyFinished(a: RestoreHistoryEntry, b: RestoreHistoryEntry): number {
  const endA = a.session.endsAt ?? 0;
  const endB = b.session.endsAt ?? 0;
  if (endA !== endB) return endB - endA;
  return b.session.startedAt - a.session.startedAt;
}

/**
 * The context "undo that" refers to, or null when there is nothing to undo.
 *
 * Eligibility is D3.2's: the context has finished AND its originals are still stored.
 * Once a restore has completed and its snapshots have been cleaned up, the context
 * stops being a candidate — so a second "undo that" moves on rather than replaying a
 * context that has already been put back.
 *
 * Ordered by end time, not start time: if a long context and a short one overlap, the
 * one that finished last is the one the user just came out of.
 */
export async function findReversibleContext(
  profileId: string,
  now: number = Date.now(),
): Promise<RestoreHistoryEntry | null> {
  const candidates = await listRestorableContexts(profileId, now);
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort(byMostRecentlyFinished)[0]!;
}

/** The originals belonging to one specific context. */
export async function getRestorationTarget(sessionId: string): Promise<RestorationTarget | null> {
  const session = await sessionRepository.getById(sessionId);
  if (!session) {
    return null;
  }

  const [profile, snapshots] = await Promise.all([
    profileRepository.getProfileById(session.profileId),
    // Scoped by sessionId in SQL, so another context's originals cannot leak in.
    snapshotRepository.getBySession(session.id),
  ]);

  return {
    session,
    profile,
    restorable: snapshots.filter((s) => s.previousValue !== null),
    unavailable: snapshots.filter((s) => s.previousValue === null),
  };
}

/**
 * Selection and retrieval in one step: what "undo that" should put back.
 *
 * Null means there is genuinely nothing to undo — never an empty target that a caller
 * might mistake for "a context ran and changed nothing".
 */
export async function findRestorationTarget(
  profileId: string,
  now: number = Date.now(),
): Promise<RestorationTarget | null> {
  const context = await findReversibleContext(profileId, now);
  if (!context) {
    return null;
  }
  return getRestorationTarget(context.session.id);
}
