/**
 * OWNER: DHREY — task D-V7 (Session / Context Foundation)
 *
 * The lifecycle of a running context, over the EXISTING context_session table and
 * sessionRepository. No second session store, no second session type — this is a thin
 * domain layer, the same shape as profileContext.ts is for D-V3.
 *
 *   startSession → markSessionActive → endSession
 *        │                                  │
 *        └──────── getActiveContext ────────┘
 *
 * Ending a session UPDATES it. Nothing is deleted: the row, its snapshots, its
 * overrides and its command log all survive, because restoration and the History
 * screen both read back through them (FLOW.md §6, §7).
 *
 * CONTRACT NOTE — there is no `ENDED` state. SESSION_STATES (frozen, types/policy.ts)
 * runs IDLE · PARSING · NEED_CONFIRMATION · READY · SNAPSHOTTING · APPLYING · ACTIVE ·
 * OVERRIDING · RESTORING · PARTIAL · ERROR. Endedness is therefore modelled the way the
 * schema already models it — by `endsAt` — and a finished session comes to rest at
 * `IDLE`, which is what `getActive()` already excludes and what the D4 store's
 * clearActiveContext() already reverts to. This module does not invent a state.
 */

import type { ContextProfile, ContextSession, DeviceSnapshot, SessionState } from '../types';
import { sessionRepository, snapshotRepository } from './repositories';

export interface StartSessionInput {
  profileId: string;
  /** Injectable clock. */
  now?: number;
  /** null / omitted = open-ended. Sets endsAt when given. */
  durationMinutes?: number | null;
  /**
   * Defaults to READY: a session exists as soon as a plan is built, but nothing has
   * touched the device yet. The executor moves it to ACTIVE once actions are applied.
   */
  status?: SessionState;
}

/** A running context and the session carrying it. */
export interface ActiveContext {
  session: ContextSession;
  profileId: string;
}

/** Create the session a plan and its snapshots will belong to. */
export async function startSession(input: StartSessionInput): Promise<ContextSession> {
  const now = input.now ?? Date.now();
  const duration = input.durationMinutes ?? null;

  const session: ContextSession = {
    id: `sess_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    profileId: input.profileId,
    startedAt: now,
    endsAt: duration === null ? null : now + duration * 60_000,
    status: input.status ?? 'READY',
  };

  await sessionRepository.create(session);
  return session;
}

/**
 * READY → ACTIVE, once the device actually changed.
 *
 * Separate from startSession so nothing can report a context as active before the
 * action engine has applied anything — the same "never fake success" rule the
 * ActionResult vocabulary enforces (PRD §20, NFR-03).
 */
export async function markSessionActive(sessionId: string): Promise<ContextSession | null> {
  const session = await sessionRepository.getById(sessionId);
  if (!session) return null;

  await sessionRepository.update({ ...session, status: 'ACTIVE' });
  return sessionRepository.getById(sessionId);
}

export interface EndSessionOptions {
  now?: number;
  /**
   * Terminal state. Defaults to IDLE — "no context running". Pass PARTIAL when a
   * restore did not fully succeed, so the snapshots stay meaningful for a retry.
   */
  status?: SessionState;
}

/**
 * End a session without destroying it.
 *
 * Sets `endsAt`, which is what makes it no longer active, and moves the status to a
 * resting state. The row and everything hanging off it remain queryable.
 */
export async function endSession(
  sessionId: string,
  options: EndSessionOptions = {},
): Promise<ContextSession | null> {
  const existing = await sessionRepository.getById(sessionId);
  if (!existing) return null;

  const now = options.now ?? Date.now();
  await sessionRepository.endSession(sessionId, options.status ?? 'IDLE', now);
  return sessionRepository.getById(sessionId);
}

/** Which context is running right now, across every profile. */
export async function getActiveContext(now?: number): Promise<ActiveContext | null> {
  const session = await sessionRepository.getActive(now);
  if (!session) return null;
  return { session, profileId: session.profileId };
}

/** Whether THIS context is the one currently running. */
export async function getActiveSessionForProfile(
  profileId: string,
  now?: number,
): Promise<ContextSession | null> {
  return sessionRepository.getActiveForProfile(profileId, now);
}

/** Full session history for a context, newest first. Ended sessions are retained. */
export async function listSessionHistory(profileId: string): Promise<ContextSession[]> {
  return sessionRepository.listForProfile(profileId);
}

/**
 * The state captured before a session's actions ran — restoration's source of truth.
 *
 * Read-only here. D-V7 establishes the association; performing the restore is the
 * action engine's job (FLOW.md §6), and no device code belongs in this layer.
 */
export async function getSessionSnapshots(sessionId: string): Promise<DeviceSnapshot[]> {
  return snapshotRepository.getBySession(sessionId);
}

/** Convenience for a caller that already holds the profile. */
export async function startSessionForProfile(
  profile: ContextProfile,
  options: Omit<StartSessionInput, 'profileId'> = {},
): Promise<ContextSession> {
  return startSession({ ...options, profileId: profile.id });
}
