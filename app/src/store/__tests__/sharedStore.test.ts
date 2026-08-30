/**
 * OWNER: DHREY — task D-V8 (Zustand Shared Store)
 *
 * Covers the Phase 2 gaps D4's useStore.test.ts does not: independent pointers, the
 * session reset that preserves the user's chosen profile, and the boundary rules —
 * the store holds ids and results, never database rows, and a runtime reset never
 * deletes anything persisted.
 *
 * useStore.test.ts is left exactly as it was.
 */

import { useStore } from '../useStore';
import { getDatabase } from '../../memory/database';
import { ensureSeeded, sessionRepository, startSession } from '../../memory';
import { activateFromText } from '../../services/contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import { ACTION_STATUSES, SESSION_STATES } from '../../types';
import type { ActionPlan, ActionResult, ParseResult, SessionState } from '../../types';

const STUDY = 'profile_study';

const engine = {
  async parse(text: string): Promise<ParseResult> {
    const result = await new FallbackParser().parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

const PLAN: ActionPlan = {
  sessionId: 'sess_dv8',
  restoreOnEnd: true,
  actions: [
    {
      capability: 'brightness',
      value: 40,
      needsSnapshot: true,
      requiredPermission: 'write_settings',
      reason: 'from system defaults',
    },
  ],
};

const RESULT: ActionResult = {
  capability: 'brightness',
  status: 'applied',
  beforeValue: 80,
  afterValue: 40,
  message: 'Applied',
};

function resetStore() {
  useStore.setState({
    sessionState: 'IDLE',
    activeProfileId: null,
    activeSessionId: null,
    currentTranscript: null,
    latestPlan: null,
    latestResults: [],
    error: null,
  });
}

describe('D-V8 shared runtime store', () => {
  beforeEach(resetStore);

  // ── TEST 1 — initial state ────────────────────────────────────────────────
  it('DV8-1: initialises to a safe runtime state', () => {
    const s = useStore.getState();

    expect(s.sessionState).toBe('IDLE');
    expect(SESSION_STATES as readonly string[]).toContain(s.sessionState);
    expect(s.activeProfileId).toBeNull();
    expect(s.activeSessionId).toBeNull();
    expect(s.currentTranscript).toBeNull();
    expect(s.latestPlan).toBeNull();
    expect(s.latestResults).toEqual([]);
    expect(s.error).toBeNull();
  });

  // ── TEST 2 — active profile ───────────────────────────────────────────────
  it('DV8-2: the active profile is a pointer, set independently of any session', () => {
    useStore.getState().setActiveProfileId(STUDY);

    const s = useStore.getState();
    expect(s.activeProfileId).toBe(STUDY);
    expect(typeof s.activeProfileId).toBe('string');
    // A profile can be chosen before any session exists.
    expect(s.activeSessionId).toBeNull();
  });

  it('DV8-2b: no profile record, preferences, overrides or priorities are cached', () => {
    useStore.getState().setActiveProfileId(STUDY);

    const s = useStore.getState() as unknown as Record<string, unknown>;
    for (const key of [
      'activeProfile',
      'profile',
      'preferences',
      'overrides',
      'priorityPreferences',
      'snapshots',
      'session',
    ]) {
      expect(s).not.toHaveProperty(key);
    }
  });

  // ── TEST 3 — active session ───────────────────────────────────────────────
  it('DV8-3: the active session is a pointer, set independently of the profile', () => {
    useStore.getState().setActiveSessionId('sess_abc');

    expect(useStore.getState().activeSessionId).toBe('sess_abc');
    expect(useStore.getState().activeProfileId).toBeNull();

    useStore.getState().setActiveSessionId(null);
    expect(useStore.getState().activeSessionId).toBeNull();
  });

  // ── TEST 4 — session lifecycle ────────────────────────────────────────────
  it('DV8-4: transitions through the frozen SessionState vocabulary only', () => {
    const lifecycle: SessionState[] = ['PARSING', 'READY', 'APPLYING', 'ACTIVE', 'IDLE'];

    for (const state of lifecycle) {
      useStore.getState().setSessionState(state);
      expect(useStore.getState().sessionState).toBe(state);
      expect(SESSION_STATES as readonly string[]).toContain(useStore.getState().sessionState);
    }

    // An invalid state is a compile error, not a runtime check:
    //   useStore.getState().setSessionState('ENDED');  // ✗ not in SessionState
  });

  // ── TEST 5 — transcript ───────────────────────────────────────────────────
  it('DV8-5: the transcript is runtime-only and never written to SQLite', async () => {
    await getDatabase();
    useStore.getState().setTranscript('I am going to study for two hours');

    expect(useStore.getState().currentTranscript).toBe('I am going to study for two hours');

    // Setting a transcript persists nothing: the command log is written by the
    // orchestrator, not by the store.
    const { commandRepository } = await import('../../memory');
    const logged = await commandRepository.getRecentCommands(50);
    expect(logged.some((c) => c.rawText === 'I am going to study for two hours')).toBe(false);
  });

  // ── TEST 6 — ActionPlan held, not recomputed ──────────────────────────────
  it('DV8-6: the plan is stored verbatim and never modified by the store', () => {
    const snapshot = JSON.parse(JSON.stringify(PLAN));

    useStore.getState().setLatestPlan(PLAN);

    const stored = useStore.getState().latestPlan;
    expect(stored).toEqual(snapshot);
    // Same reference in, same reference out — nothing was rebuilt.
    expect(stored).toBe(PLAN);
    // And the caller's object was not mutated.
    expect(PLAN).toEqual(snapshot);
  });

  // ── TEST 7 — ActionResult ─────────────────────────────────────────────────
  it('DV8-7: results use the frozen ActionStatus vocabulary', () => {
    useStore.getState().setLatestResults([RESULT]);

    const stored = useStore.getState().latestResults;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.capability).toBe('brightness');
    expect(ACTION_STATUSES as readonly string[]).toContain(stored[0]!.status);
  });

  // ── TEST 8 — error ────────────────────────────────────────────────────────
  it('DV8-8: an error is exposed and resettable', () => {
    useStore.getState().setError('Android did not hold the change.');
    expect(useStore.getState().error).toBe('Android did not hold the change.');

    useStore.getState().clearError();
    expect(useStore.getState().error).toBeNull();
  });

  // ── TEST 9 — session reset ────────────────────────────────────────────────
  it('DV8-9: resetSession clears the run but keeps the chosen profile', () => {
    useStore.getState().setActiveContext(STUDY, 'sess_live');
    useStore.getState().setSessionState('ACTIVE');
    useStore.getState().setTranscript('studying');
    useStore.getState().setLatestPlan(PLAN);
    useStore.getState().setLatestResults([RESULT]);
    useStore.getState().setError('something went wrong');

    useStore.getState().resetSession();

    const s = useStore.getState();
    expect(s.activeSessionId).toBeNull();
    expect(s.sessionState).toBe('IDLE');
    expect(s.currentTranscript).toBeNull();
    expect(s.latestPlan).toBeNull();
    expect(s.latestResults).toEqual([]);
    expect(s.error).toBeNull();
    // The user's standing context choice survives the reset.
    expect(s.activeProfileId).toBe(STUDY);
  });

  it('DV8-9b: a runtime reset deletes nothing persisted', async () => {
    await getDatabase();
    await ensureSeeded();

    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    useStore.getState().setActiveContext(STUDY, session.id);

    useStore.getState().resetSession();

    // Pointer gone from runtime state…
    expect(useStore.getState().activeSessionId).toBeNull();
    // …row still in SQLite. A store reset is not a delete.
    const stored = await sessionRepository.getById(session.id);
    expect(stored).not.toBeNull();
    expect(stored!.profileId).toBe(STUDY);
  });

  // ── TEST 10 — one store ───────────────────────────────────────────────────
  it('DV8-10: every consumer shares one store instance', async () => {
    const viaBarrel = (await import('../index')).useStore;
    const viaModule = (await import('../useStore')).useStore;

    expect(viaBarrel).toBe(viaModule);

    viaBarrel.getState().setActiveProfileId(STUDY);
    expect(viaModule.getState().activeProfileId).toBe(STUDY);
  });

  // ── TEST 11 — D-V6 compatibility ──────────────────────────────────────────
  it('DV8-11: a real vertical-slice plan goes into the store unchanged', async () => {
    await getDatabase();
    await ensureSeeded();

    const outcome = await activateFromText("I'm going to study for two hours.", { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const before = JSON.parse(JSON.stringify(outcome.plan));

    useStore.getState().setActiveContext(outcome.profile.id, outcome.plan.sessionId);
    useStore.getState().setLatestPlan(outcome.plan);
    useStore.getState().setSessionState('READY');

    const s = useStore.getState();
    expect(s.activeProfileId).toBe(STUDY);
    expect(s.activeSessionId).toBe(outcome.plan.sessionId);
    expect(s.sessionState).toBe('READY');
    // Byte-identical: the store held the plan, it did not re-decide it.
    expect(s.latestPlan).toEqual(before);
    expect(s.latestPlan!.actions.length).toBe(outcome.policy.entries.length);
  });
});
