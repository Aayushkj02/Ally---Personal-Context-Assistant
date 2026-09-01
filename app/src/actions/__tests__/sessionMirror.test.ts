/**
 * OWNER: AAYUSH — Phase 6 (A6.5)
 *
 * SOFTWARE / SESSION-SYNC VALIDATION.
 *
 * READ THE LABEL BEFORE READING THE RESULTS. Every test in this file exercises session-sync LOGIC
 * against a recording transport. A green run here proves message shape, ordering, containment and
 * that nothing is recomputed. It proves NOTHING about physical Office Kit hardware, because:
 *
 * > Physical Office Kit validation is deferred until the team qualifies for the Pune round and
 * > receives the Office Kit. Until then, development and real-device testing use the Samsung
 * > Galaxy S24 Ultra.
 *
 * No result from this file may be reported as hardware validation, and the recorder below is a
 * mock of a TRANSPORT, not of a device.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type { ActionPlan, Capability, PlannedAction } from '../../types';
import {
  mockRegistry,
  __resetMockState,
  __setMockBrightnessRaw,
  __setMockPermission,
} from '../../native/MockDevice';
import {
  startContext,
  endContext,
  createInMemorySnapshotStore,
  mirrorContextStart,
  mirrorContextEnd,
  createRecordingTransport,
  type SessionMirrorTransport,
} from '../index';

const SESSION = 'sess_mirror';
const PROFILE = 'profile_study';

function action(overrides: Partial<PlannedAction> & { capability: Capability }): PlannedAction {
  return {
    value: 'priority',
    needsSnapshot: true,
    requiredPermission: 'notification_policy',
    reason: 'from system defaults',
    ...overrides,
  };
}

const studyPlan = (): ActionPlan => ({
  sessionId: SESSION,
  restoreOnEnd: true,
  actions: [
    action({ capability: 'dnd', value: 'priority' }),
    action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
  ],
});

beforeEach(() => {
  __resetMockState();
  __setMockBrightnessRaw(187);
});

// ---------------------------------------------------------------------------
// The four events a laptop needs, in the order the phone lived them
// ---------------------------------------------------------------------------

describe('A6.5 — a started context is mirrored', () => {
  it('pushes session, plan, results and state, in lifecycle order', async () => {
    const plan = studyPlan();
    const started = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    const { transport, sent } = createRecordingTransport();
    const outcome = await mirrorContextStart(plan, started, transport, {
      profileId: PROFILE,
      durationMinutes: 120,
    });

    expect(sent.map((m) => m.event)).toEqual([
      'session_started',
      'plan_submitted',
      'results_received',
      'session_state_changed',
    ]);
    expect(outcome.delivered).toBe(true);
    expect(sent.every((m) => m.sessionId === SESSION)).toBe(true);
  });

  it("forwards the coordinator's own values — nothing is recomputed", async () => {
    const plan = studyPlan();
    const started = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    const { transport, sent } = createRecordingTransport();
    await mirrorContextStart(plan, started, transport, {
      profileId: PROFILE,
      durationMinutes: 120,
    });

    const results = sent.find((m) => m.event === 'results_received')?.payload as {
      results: unknown;
    };
    const state = sent.find((m) => m.event === 'session_state_changed')?.payload as {
      sessionState: unknown;
    };
    const submitted = sent.find((m) => m.event === 'plan_submitted')?.payload as { plan: unknown };

    // Identity, not equality: the mirror hands over the very objects the lifecycle produced.
    expect(results.results).toBe(started.results);
    expect(state.sessionState).toBe(started.state);
    expect(submitted.plan).toBe(plan);
  });

  it('mirrors PARTIAL as PARTIAL — a shortfall is not rounded up in transit', async () => {
    // brightness is blocked, dnd applies. The honest answer is PARTIAL, and a laptop that showed
    // "running" would undo the entire status vocabulary.
    __setMockPermission('write_settings', false);
    const plan = studyPlan();
    const started = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });
    expect(started.state).toBe('PARTIAL');

    const { transport, sent } = createRecordingTransport();
    await mirrorContextStart(plan, started, transport, { profileId: PROFILE });

    const state = sent.find((m) => m.event === 'session_state_changed')?.payload as {
      sessionState: string;
    };
    expect(state.sessionState).toBe('PARTIAL');
  });

  it('mirrors a context that applied NOTHING — the plan still goes across', async () => {
    const plan = studyPlan();
    const started = await startContext(plan, {
      registry: {
        backend: 'mock',
        get() {
          throw new Error('no capability');
        },
        async openSettingsFor() {},
      },
      snapshots: createInMemorySnapshotStore(),
    });
    expect(started.state).toBe('ERROR');

    const { transport, sent } = createRecordingTransport();
    await mirrorContextStart(plan, started, transport, { profileId: PROFILE });

    // A failed context is still something the user did. A mirror that showed only successes
    // would be a highlight reel.
    expect(sent.map((m) => m.event)).toContain('plan_submitted');
    const state = sent.find((m) => m.event === 'session_state_changed')?.payload as {
      sessionState: string;
    };
    expect(state.sessionState).toBe('ERROR');
  });

  it('carries an open-ended session as null, not as a guessed number', async () => {
    const plan = studyPlan();
    const started = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    const { transport, sent } = createRecordingTransport();
    await mirrorContextStart(plan, started, transport, { profileId: PROFILE });

    const payload = sent[0]?.payload as { durationMinutes: number | null };
    expect(payload.durationMinutes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------

describe('A6.5 — an ended context is mirrored', () => {
  it('pushes what was restored before it pushes the ending', async () => {
    const plan = studyPlan();
    const snapshots = createInMemorySnapshotStore();
    await startContext(plan, { registry: mockRegistry, snapshots });
    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots });

    const { transport, sent } = createRecordingTransport();
    await mirrorContextEnd(ended, transport, { profileId: PROFILE });

    // Order matters: a laptop should be able to show WHAT went back, not merely that it ended.
    expect(sent.map((m) => m.event)).toEqual(['results_received', 'session_ended']);
    expect((sent[1]?.payload as { finalState: string }).finalState).toBe('IDLE');
  });

  it('mirrors a PARTIAL restore as PARTIAL, not as a clean ending', async () => {
    const plan = studyPlan();
    const snapshots = createInMemorySnapshotStore();
    await startContext(plan, { registry: mockRegistry, snapshots });

    __setMockPermission('write_settings', false);
    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots });
    expect(ended.state).toBe('PARTIAL');

    const { transport, sent } = createRecordingTransport();
    await mirrorContextEnd(ended, transport, { profileId: PROFILE });

    // Unfinished business the second screen should be able to display (ADR-117).
    expect((sent[1]?.payload as { finalState: string }).finalState).toBe('PARTIAL');
  });
});

// ---------------------------------------------------------------------------
// A mirror must never affect the thing it mirrors
// ---------------------------------------------------------------------------

describe('A6.5 — a dead bridge is invisible', () => {
  it('reports delivered:false instead of throwing when the transport fails', async () => {
    const plan = studyPlan();
    const started = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    // Every second call throws.
    const { transport } = createRecordingTransport({ failEvery: 2 });
    const outcome = await mirrorContextStart(plan, started, transport, { profileId: PROFILE });

    expect(outcome.delivered).toBe(false);
    // It still attempted all four rather than stopping at the first refusal.
    expect(outcome.events).toHaveLength(4);
  });

  it('a transport that throws on EVERY call still cannot break the caller', async () => {
    const exploding: SessionMirrorTransport = {
      syncSessionStarted: () => Promise.reject(new Error('down')),
      syncPlanSubmitted: () => Promise.reject(new Error('down')),
      syncResultsReceived: () => Promise.reject(new Error('down')),
      syncStateChanged: () => Promise.reject(new Error('down')),
      syncSessionEnded: () => Promise.reject(new Error('down')),
    };

    const plan = studyPlan();
    const snapshots = createInMemorySnapshotStore();
    const started = await startContext(plan, { registry: mockRegistry, snapshots });

    await expect(
      mirrorContextStart(plan, started, exploding, { profileId: PROFILE }),
    ).resolves.toEqual({
      events: ['session_started', 'plan_submitted', 'results_received', 'session_state_changed'],
      delivered: false,
    });

    // And the phone is entirely unaffected: the context still ends and restores exactly.
    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots });
    await expect(mirrorContextEnd(ended, exploding, { profileId: PROFILE })).resolves.toMatchObject(
      {
        delivered: false,
      },
    );
    expect(ended.state).toBe('IDLE');
  });

  it('mirroring writes nothing to the device or the snapshots', async () => {
    const plan = studyPlan();
    const snapshots = createInMemorySnapshotStore();
    const started = await startContext(plan, { registry: mockRegistry, snapshots });
    const before = await snapshots.forSession(SESSION);

    const { transport } = createRecordingTransport();
    await mirrorContextStart(plan, started, transport, { profileId: PROFILE });

    // A mirror observes. It has no business changing anything.
    expect(await snapshots.forSession(SESSION)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// What this file does NOT prove
// ---------------------------------------------------------------------------

describe('A6.5 — scope of this evidence', () => {
  it('is a transport mock, and says so — no hardware claim is available from here', () => {
    // Deliberately an assertion about intent rather than behaviour. It exists so that anyone
    // reading a green run of this suite is told, in the run itself, what it does not cover.
    const { transport } = createRecordingTransport();
    expect(typeof transport.syncSessionStarted).toBe('function');

    // The physical Office Kit has not been received. Nothing here has spoken to one, and no
    // amount of green in this file changes that.
    const physicalOfficeKitValidated = false;
    expect(physicalOfficeKitValidated).toBe(false);
  });
});
