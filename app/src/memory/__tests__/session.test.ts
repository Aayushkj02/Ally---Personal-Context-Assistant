/**
 * OWNER: DHREY — task D-V7 (Session / Context Foundation)
 *
 * Real repositories against the in-memory SQLite the other D1 tests use. No second
 * session store is introduced, so these assert behaviour of the existing
 * context_session / device_snapshot / temporary_override tables.
 */

import { getDatabase } from '../database';
import {
  endSession,
  ensureSeeded,
  getActiveContext,
  getActiveSessionForProfile,
  getSessionSnapshots,
  listSessionHistory,
  markSessionActive,
  overrideRepository,
  sessionRepository,
  snapshotRepository,
  startSession,
} from '../index';
import { activateFromText } from '../../services/contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import { useStore } from '../../store';
import { SESSION_STATES } from '../../types';
import type { ParseResult } from '../../types';

const STUDY = 'profile_study';
const SLEEP = 'profile_sleep';

const engine = {
  async parse(text: string): Promise<ParseResult> {
    const result = await new FallbackParser().parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

/**
 * Close every open-ended session so each test starts with no running context.
 *
 * Sessions with a fixed endsAt are left alone — they bound themselves, and rewriting
 * their end time would corrupt the history assertions in DV7-4b.
 */
async function closeAllSessions() {
  for (const profileId of [STUDY, SLEEP]) {
    for (const s of await listSessionHistory(profileId)) {
      if (s.endsAt === null) {
        await endSession(s.id);
      }
    }
  }
}

describe('D-V7 session / context foundation', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(closeAllSessions);

  // ── TEST 1 — start ─────────────────────────────────────────────────────────
  it('DV7-1: starting a session records the profile, start time and status', async () => {
    const now = 1_700_000_000_000;
    const session = await startSession({ profileId: STUDY, now, durationMinutes: 120 });

    expect(session.id).toBeTruthy();
    expect(session.profileId).toBe(STUDY);
    expect(session.startedAt).toBe(now);
    expect(session.endsAt).toBe(now + 120 * 60_000);
    // READY, not ACTIVE — nothing has touched the device yet.
    expect(session.status).toBe('READY');
    expect(SESSION_STATES as readonly string[]).toContain(session.status);

    const stored = await sessionRepository.getById(session.id);
    expect(stored).not.toBeNull();
    expect(stored!.profileId).toBe(STUDY);
  });

  it('DV7-1b: an open-ended session has no end time', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    expect(session.endsAt).toBeNull();
  });

  it('DV7-1c: READY becomes ACTIVE only when explicitly marked', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    expect(session.status).toBe('READY');

    const active = await markSessionActive(session.id);
    expect(active!.status).toBe('ACTIVE');
  });

  // ── TEST 2 — active lookup ─────────────────────────────────────────────────
  it('DV7-2: the active session can be retrieved', async () => {
    const now = Date.now();
    const session = await startSession({ profileId: STUDY, now, durationMinutes: null });

    const context = await getActiveContext(now);
    expect(context).not.toBeNull();
    expect(context!.session.id).toBe(session.id);
    expect(context!.profileId).toBe(STUDY);
  });

  it('DV7-2b: a duration-bounded session is active until its end time passes', async () => {
    // The regression this task fixed: `endsAt IS NULL` meant a two-hour study context —
    // which sets endsAt at creation — was never reported as active.
    // A base distinct from DV7-1's, so no earlier fixture is still open at this instant.
    const now = 1_710_000_000_000;
    const session = await startSession({ profileId: STUDY, now, durationMinutes: 120 });

    const during = await getActiveContext(now + 60 * 60_000);
    expect(during).not.toBeNull();
    expect(during!.session.id).toBe(session.id);

    const after = await getActiveContext(now + 180 * 60_000);
    expect(after?.session.id).not.toBe(session.id);
  });

  it('DV7-2c: active lookup can be scoped to one profile', async () => {
    const now = Date.now();
    await startSession({ profileId: SLEEP, now, durationMinutes: null });

    const sleep = await getActiveSessionForProfile(SLEEP, now);
    const study = await getActiveSessionForProfile(STUDY, now);

    expect(sleep).not.toBeNull();
    expect(sleep!.profileId).toBe(SLEEP);
    expect(study).toBeNull();
  });

  // ── TEST 3 — end ───────────────────────────────────────────────────────────
  it('DV7-3: ending a session sets the end time and stops it being active', async () => {
    const now = Date.now();
    const session = await startSession({ profileId: STUDY, now, durationMinutes: null });

    const ended = await endSession(session.id, { now: now + 1000 });

    expect(ended).not.toBeNull();
    expect(ended!.endsAt).toBe(now + 1000);
    expect(ended!.status).toBe('IDLE');
    expect(SESSION_STATES as readonly string[]).toContain(ended!.status);

    expect(await getActiveSessionForProfile(STUDY, now + 2000)).toBeNull();
  });

  it('DV7-3b: a caller may end a session in PARTIAL when restore did not fully succeed', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    const ended = await endSession(session.id, { status: 'PARTIAL' });

    expect(ended!.status).toBe('PARTIAL');
    // Still retained, so the snapshots remain usable for a retry.
    expect(await sessionRepository.getById(session.id)).not.toBeNull();
  });

  // ── TEST 4 — history is never destroyed ────────────────────────────────────
  it('DV7-4: an ended session remains queryable', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    await endSession(session.id);

    const byId = await sessionRepository.getById(session.id);
    expect(byId).not.toBeNull();

    const history = await listSessionHistory(STUDY);
    expect(history.map((s) => s.id)).toContain(session.id);
  });

  it('DV7-4b: history accumulates rather than overwriting', async () => {
    const before = (await listSessionHistory(STUDY)).length;

    const a = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await endSession(a.id, { now: 2000 });
    const b = await startSession({ profileId: STUDY, now: 3000, durationMinutes: null });
    await endSession(b.id, { now: 4000 });

    const history = await listSessionHistory(STUDY);
    expect(history.length).toBe(before + 2);
    expect(history.map((s) => s.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  // ── TEST 5 — profile association ───────────────────────────────────────────
  it('DV7-5: a session identifies the profile it belongs to', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    const stored = await sessionRepository.getById(session.id);

    expect(stored!.profileId).toBe(STUDY);
    // The session does not copy the profile's configuration.
    expect(Object.keys(stored!).sort()).toEqual(
      ['endsAt', 'id', 'profileId', 'startedAt', 'status'].sort(),
    );
  });

  // ── TEST 6 — temporary override association ────────────────────────────────
  it('DV7-6: overrides stay attached to the profile/context per the existing schema', async () => {
    const now = Date.now();
    const session = await startSession({ profileId: STUDY, now, durationMinutes: null });

    await overrideRepository.create({
      id: 'dv7_ovr',
      profileId: STUDY,
      capability: 'brightness',
      value: 55,
      subject: null,
      effect: 'allow',
      startAt: now - 1000,
      expiresAt: now + 3_600_000,
      active: true,
      sourceCommand: 'brighten for an hour',
    });

    const active = await overrideRepository.getActiveForProfile(STUDY);
    expect(active.map((o) => o.id)).toContain('dv7_ovr');
    // The override is scoped to the profile, and the session names the same profile.
    expect(active[0]!.profileId).toBe(session.profileId);

    // Ending the context does not mutate the override into a persistent preference.
    await endSession(session.id);
    const stillThere = await overrideRepository.getById('dv7_ovr');
    expect(stillThere).not.toBeNull();
    expect(stillThere!.profileId).toBe(STUDY);

    await overrideRepository.delete('dv7_ovr');
  });

  // ── TEST 7 — snapshot association ──────────────────────────────────────────
  it('DV7-7: snapshots belong to their session and preserve the previous value', async () => {
    const now = Date.now();
    const session = await startSession({ profileId: STUDY, now, durationMinutes: null });

    await snapshotRepository.create({
      id: 'dv7_snap',
      sessionId: session.id,
      capability: 'brightness',
      previousValue: 82,
      capturedAt: now,
    });

    const snapshots = await getSessionSnapshots(session.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.previousValue).toBe(82);
    expect(snapshots[0]!.sessionId).toBe(session.id);

    // Ending the session must not destroy what restoration reads.
    await endSession(session.id);
    const afterEnd = await getSessionSnapshots(session.id);
    expect(afterEnd).toHaveLength(1);
    expect(afterEnd[0]!.previousValue).toBe(82);
  });

  // ── TEST 8 — multiple sessions stay distinct ───────────────────────────────
  it('DV7-8: Study and Sleep sessions do not overwrite one another', async () => {
    const now = Date.now();
    const study = await startSession({ profileId: STUDY, now, durationMinutes: null });
    const sleep = await startSession({ profileId: SLEEP, now: now + 10, durationMinutes: null });

    expect(study.id).not.toBe(sleep.id);

    const studyActive = await getActiveSessionForProfile(STUDY, now + 20);
    const sleepActive = await getActiveSessionForProfile(SLEEP, now + 20);

    expect(studyActive!.id).toBe(study.id);
    expect(sleepActive!.id).toBe(sleep.id);

    // Ending one leaves the other running.
    await endSession(study.id, { now: now + 30 });
    expect(await getActiveSessionForProfile(STUDY, now + 40)).toBeNull();
    expect((await getActiveSessionForProfile(SLEEP, now + 40))!.id).toBe(sleep.id);
  });

  // ── TEST 9 — Zustand holds pointers, not records ───────────────────────────
  it('DV7-9: the store holds lightweight pointers, never SQLite records', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });

    useStore.getState().setActiveContext(STUDY, session.id);
    useStore.getState().setSessionState('ACTIVE');

    const state = useStore.getState();
    expect(state.activeProfileId).toBe(STUDY);
    expect(state.activeSessionId).toBe(session.id);
    expect(state.sessionState).toBe('ACTIVE');

    // Pointers are strings — no row objects were copied into runtime state.
    expect(typeof state.activeProfileId).toBe('string');
    expect(typeof state.activeSessionId).toBe('string');
    expect(state).not.toHaveProperty('session');
    expect(state).not.toHaveProperty('profile');
    expect(state).not.toHaveProperty('preferences');
    expect(state).not.toHaveProperty('overrides');

    useStore.getState().clearActiveContext();
    expect(useStore.getState().activeProfileId).toBeNull();
    expect(useStore.getState().activeSessionId).toBeNull();
    expect(useStore.getState().sessionState).toBe('IDLE');
  });

  // ── TEST 10 — D-V6 regression ──────────────────────────────────────────────
  it('DV7-10: the canonical vertical slice still produces a session-bound ActionPlan', async () => {
    const outcome = await activateFromText("I'm going to study for two hours.", { engine });

    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const session = await sessionRepository.getById(outcome.plan.sessionId);
    expect(session).not.toBeNull();
    expect(session!.profileId).toBe(STUDY);
    expect(session!.status).toBe('READY');
    // Two hours, recorded on the session the plan points at.
    expect(session!.endsAt).toBe(session!.startedAt + 120 * 60_000);

    expect(outcome.plan.actions.length).toBeGreaterThan(0);
  });
});
