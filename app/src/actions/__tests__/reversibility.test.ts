/**
 * OWNER: AAYUSH — Phase 3 (A3.1, A3.4, A3.5, A3.6)
 *
 * Reversibility, taken past the happy path.
 *
 * Phase 2 proved the mechanism: 187 -> 102 -> process death -> 187. These are the cases that
 * mechanism did not cover, and each one is a way a context could end while still holding
 * something of the user's:
 *
 *   ADR-123  restoring to a mode the user was ALREADY in re-asserted Ally's own zen rule, so
 *            the read-back said "priority" and the restore reported clean while Ally's rule was
 *            the thing holding their phone silent — with the snapshots then cleared.
 *   ADR-124  a READ taken during a borrow could overwrite the exact raw value the restore
 *            depends on, so the retry after a granted permission gave back Ally's number.
 *   ADR-125  priority rewrites the notification policy from OUTSIDE the ActionPlan, so a
 *            context with no `dnd` action borrowed it with no snapshot row to carry it back.
 *
 * All three share a shape: the restore reported success and the user's phone was still changed.
 * That is the failure this file exists to make impossible to reintroduce quietly.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type {
  ActionPlan,
  ActionResult,
  Capability,
  DeviceCapability,
  DeviceRegistry,
  PlannedAction,
} from '../../types';
import {
  mockRegistry,
  mockBorrowedPolicy,
  __resetMockState,
  __setMockPermission,
  __setMockBrightnessRaw,
  __getMockBrightnessRaw,
  __getMockBrightnessPercent,
  __setMockUserDnd,
  __getMockAllyRuleActive,
  __getMockState,
  __getMockPolicy,
  __getMockSavedPolicy,
  __setMockPolicy,
  __applyMockPriorityPolicy,
  __simulateProcessDeath,
} from '../../native/MockDevice';
import {
  startContext,
  endContext,
  executePlan,
  createInMemorySnapshotStore,
  type BorrowedPolicy,
  type SnapshotStore,
} from '../index';

const SESSION = 'session-1';

function action(overrides: Partial<PlannedAction> & { capability: Capability }): PlannedAction {
  return {
    value: 'priority',
    needsSnapshot: true,
    requiredPermission: 'notification_policy',
    reason: 'test',
    ...overrides,
  };
}

const brightnessAction = (value: number): PlannedAction =>
  action({ capability: 'brightness', value, requiredPermission: 'write_settings' });

function plan(actions: PlannedAction[]): ActionPlan {
  return { sessionId: SESSION, actions, restoreOnEnd: true };
}

function deps(snapshots: SnapshotStore, policy?: BorrowedPolicy) {
  return { registry: mockRegistry, snapshots, policy };
}

beforeEach(() => {
  __resetMockState();
});

// ---------------------------------------------------------------------------
// A3.6 / ADR-123 — the user already had Do Not Disturb on
// ---------------------------------------------------------------------------

describe('A3.6 — the filter is released, not re-asserted', () => {
  it('leaves nothing of Ally holding the filter when the user was already in priority', async () => {
    // Their own schedule had them in priority before Ally was ever asked for anything.
    __setMockUserDnd('priority');
    const snapshots = createInMemorySnapshotStore();

    await startContext(
      plan([action({ capability: 'dnd', value: 'total_silence' })]),
      deps(snapshots),
    );
    expect(__getMockState().dnd).toBe('total_silence');
    expect(__getMockAllyRuleActive()).toBe(true);

    const end = await endContext(SESSION, deps(snapshots));

    // The value is right...
    expect(__getMockState().dnd).toBe('priority');
    expect(end.state).toBe('IDLE');
    // ...and, the part that used to be wrong, it is right because the USER'S rule is holding it.
    expect(__getMockAllyRuleActive()).toBe(false);
  });

  it('says which way the mode came back, so a re-assert is never mistaken for a release', async () => {
    __setMockUserDnd('priority');
    const snapshots = createInMemorySnapshotStore();

    await startContext(
      plan([action({ capability: 'dnd', value: 'total_silence' })]),
      deps(snapshots),
    );
    const end = await endContext(SESSION, deps(snapshots));

    expect(end.results[0]?.message).toContain('zen_rule_released');
  });

  it('still returns a normal phone to off, releasing rather than forcing it', async () => {
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), deps(snapshots));
    const end = await endContext(SESSION, deps(snapshots));

    expect(__getMockState().dnd).toBe('off');
    expect(__getMockAllyRuleActive()).toBe(false);
    expect(end.results[0]?.status).toBe('restored');
  });

  it('re-asserts, and says so, when releasing does not reach the snapshotted mode', async () => {
    // The user was in priority by their own rule; while the context ran, that rule fell away.
    __setMockUserDnd('priority');
    const snapshots = createInMemorySnapshotStore();

    await startContext(
      plan([action({ capability: 'dnd', value: 'total_silence' })]),
      deps(snapshots),
    );
    __setMockUserDnd('off');

    const end = await endContext(SESSION, deps(snapshots));

    // The user is given back the value they had. Ally is now the one holding it, and the message
    // says so rather than reporting the same clean release as the case above.
    expect(__getMockState().dnd).toBe('priority');
    expect(__getMockAllyRuleActive()).toBe(true);
    expect(end.results[0]?.message).not.toContain('released');
  });
});

// ---------------------------------------------------------------------------
// A3.4 / ADR-124 — a retry must use the ORIGINAL value
// ---------------------------------------------------------------------------

describe('A3.4 — retry restores the original, never a value Ally caused', () => {
  it('gives back raw 187 after a blocked restore, not the 186 Ally itself wrote', async () => {
    // 187 and 186 BOTH report as 73%. That collision is the whole bug: a read taken while the
    // context is running looks identical to the capture, and used to overwrite it.
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([brightnessAction(73)]), deps(snapshots));
    expect(__getMockBrightnessRaw()).toBe(186); // Ally's own rounding of "73%"

    __setMockPermission('write_settings', false);
    const blockedEnd = await endContext(SESSION, deps(snapshots));
    expect(blockedEnd.results[0]?.status).toBe('permission_needed');
    expect(blockedEnd.retryable).toBe(true);
    expect(blockedEnd.cleared).toBe(false);

    __setMockPermission('write_settings', true);
    const retry = await endContext(SESSION, deps(snapshots));

    expect(retry.state).toBe('IDLE');
    expect(__getMockBrightnessRaw()).toBe(187);
  });

  it('captures no new snapshot on a restore attempt, however many attempts it takes', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([brightnessAction(40)]), deps(snapshots));
    const captured = await snapshots.forSession(SESSION);

    __setMockPermission('write_settings', false);
    await endContext(SESSION, deps(snapshots));
    await endContext(SESSION, deps(snapshots));

    // Same rows, same values, same timestamps. A restore reads; it never records.
    expect(await snapshots.forSession(SESSION)).toEqual(captured);
  });

  it('the NEXT session captures fresh — a clean restore really does end the borrow', async () => {
    // The flag that freezes the remembered value must be opened by a WRITE, not by a read. Set
    // in snapshot(), it re-armed on the display refresh that follows a restore — caught on the
    // Samsung — and this session would then have restored the value from the last one.
    __setMockBrightnessRaw(187);
    const first = createInMemorySnapshotStore();
    await startContext(plan([brightnessAction(40)]), deps(first));
    await endContext(SESSION, deps(first));
    expect(__getMockBrightnessRaw()).toBe(187);

    // The screen re-reads brightness to refresh its readout once the context has ended. This
    // line is the whole test: on the Samsung it was this read that re-armed the flag, one moment
    // after the restore cleared it.
    await mockRegistry.get('brightness').snapshot();

    // Between contexts the user nudges the slider. 186 still reports as 73% — the same key.
    __setMockBrightnessRaw(186);

    const second = createInMemorySnapshotStore();
    await startContext(
      { sessionId: 'session-2', actions: [brightnessAction(40)], restoreOnEnd: true },
      deps(second),
    );
    await endContext('session-2', deps(second));

    expect(__getMockBrightnessRaw()).toBe(186);
  });

  it('a partial restore keeps every row, including the ones that already went back', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await startContext(
      plan([action({ capability: 'dnd', value: 'priority' }), brightnessAction(40)]),
      deps(snapshots),
    );

    __setMockPermission('write_settings', false);
    const end = await endContext(SESSION, deps(snapshots));

    expect(end.state).toBe('PARTIAL');
    expect(end.cleared).toBe(false);
    expect(await snapshots.forSession(SESSION)).toHaveLength(2);

    // And the retry finishes the job rather than starting a new one.
    __setMockPermission('write_settings', true);
    const retry = await endContext(SESSION, deps(snapshots));
    expect(retry.state).toBe('IDLE');
    expect(__getMockBrightnessRaw()).toBe(187);
    expect(await snapshots.forSession(SESSION)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A3.5 — ending is safe from every state a context can be in
// ---------------------------------------------------------------------------

function failingRegistry(): DeviceRegistry {
  const dead: DeviceCapability = {
    async isAvailable() {
      return true;
    },
    async requiredPermissions() {
      return [];
    },
    async snapshot() {
      return 'off';
    },
    async execute() {
      return {
        capability: 'dnd',
        status: 'failed',
        beforeValue: 'off',
        afterValue: 'off',
        message: 'Android did not hold it.',
      } satisfies ActionResult;
    },
    async restore() {
      return {
        capability: 'dnd',
        status: 'restored',
        beforeValue: 'off',
        afterValue: 'off',
        message: 'back',
      } satisfies ActionResult;
    },
  };

  return {
    backend: 'mock',
    get() {
      return dead;
    },
    async openSettingsFor() {},
  };
}

describe('A3.5 — end is safe from any state', () => {
  it('a second end after a clean one is a no-op, not an error', async () => {
    const snapshots = createInMemorySnapshotStore();
    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), deps(snapshots));

    const first = await endContext(SESSION, deps(snapshots));
    const second = await endContext(SESSION, deps(snapshots));

    expect(first.state).toBe('IDLE');
    expect(second.state).toBe('IDLE');
    expect(second.results).toEqual([]);
    expect(second.retryable).toBe(false);
    // The device is where the first end left it — the second did not move anything.
    expect(__getMockState().dnd).toBe('off');
  });

  it('ending after a start that applied nothing leaves the device where it was', async () => {
    const snapshots = createInMemorySnapshotStore();
    const before = __getMockState().dnd;

    const start = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: failingRegistry(),
      snapshots,
    });
    expect(start.state).toBe('ERROR');

    const end = await endContext(SESSION, { registry: failingRegistry(), snapshots });

    // A snapshot WAS captured — it is taken before the write, which is the only order that can
    // be safe — so ending writes the same value back. That is a no-op, not a change.
    expect(end.state).toBe('IDLE');
    expect(__getMockState().dnd).toBe(before);
  });

  it('an unreadable snapshot store is PARTIAL and retryable, never a clean end', async () => {
    // Observed on the SM-S928B during Phase 4: expo-sqlite rejected with a NullPointerException,
    // the rejection escaped endContext(), and the app showed a red toast while the phone stayed
    // dimmed and silent. A store we cannot read is the opposite of a store with nothing in it.
    __setMockBrightnessRaw(187);
    const real = createInMemorySnapshotStore();
    await startContext(plan([brightnessAction(40)]), deps(real));

    const unreadable: SnapshotStore = {
      save: real.save,
      forSession: async () => {
        throw new Error('NullPointerException');
      },
      clear: real.clear,
    };

    const end = await endContext(SESSION, deps(unreadable));

    expect(end.state).toBe('PARTIAL');
    expect(end.state).not.toBe('IDLE');
    expect(end.cleared).toBe(false);
    expect(end.retryable).toBe(true);
    expect(end.error).toMatch(/could not read/i);
    // The device is untouched by the failure, and the rows are still there.
    expect(__getMockBrightnessPercent()).toBe(40);
    expect(await real.forSession(SESSION)).toHaveLength(1);

    // Which is the whole point: ending again finishes the job.
    const retry = await endContext(SESSION, deps(real));
    expect(retry.state).toBe('IDLE');
    expect(retry.error).toBeNull();
    expect(__getMockBrightnessRaw()).toBe(187);
  });

  it('ending a session that never started is IDLE, not a failure', async () => {
    const end = await endContext('never-ran', deps(createInMemorySnapshotStore()));

    expect(end.state).toBe('IDLE');
    expect(end.results).toEqual([]);
    expect(end.cleared).toBe(true);
  });

  it('ending after a PARTIAL start restores only what was actually applied', async () => {
    const snapshots = createInMemorySnapshotStore();
    const unavailableRinger: DeviceRegistry = {
      backend: 'mock',
      get(c) {
        if (c !== 'ringer') return mockRegistry.get(c);
        return {
          ...mockRegistry.get(c),
          async isAvailable() {
            return false;
          },
        };
      },
      async openSettingsFor() {},
    };

    const start = await startContext(
      plan([action({ capability: 'dnd', value: 'priority' }), action({ capability: 'ringer' })]),
      { registry: unavailableRinger, snapshots },
    );
    expect(start.state).toBe('PARTIAL');

    const end = await endContext(SESSION, deps(snapshots));

    // Nothing was captured for the ringer, so nothing is put back for it — and its absence is
    // silence, not a `failed` row invented to balance the plan.
    expect(end.results.map((r) => r.capability)).toEqual(['dnd']);
    expect(end.state).toBe('IDLE');
  });

  it('ending on a fresh process restores from the rows alone', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([brightnessAction(40)]), deps(snapshots));
    __simulateProcessDeath();

    const end = await endContext(SESSION, deps(snapshots));

    expect(end.state).toBe('IDLE');
    expect(__getMockBrightnessRaw()).toBe(187);
  });
});

// ---------------------------------------------------------------------------
// ADR-125 — the policy priority borrowed, with no snapshot row to carry it
// ---------------------------------------------------------------------------

describe('ADR-125 — a borrowed policy is given back without a dnd row', () => {
  /** A context of "dim the screen and let Mom through": priority, but no DND action. */
  async function brightnessOnlyContextWithPriority(snapshots: SnapshotStore) {
    __setMockBrightnessRaw(187);
    return startContext(plan([brightnessAction(40)]), {
      ...deps(snapshots, mockBorrowedPolicy),
      applyPriority: async () => {
        __applyMockPriorityPolicy(true, false);
        return [{ channel: 'calls', status: 'enforced', message: 'Starred contacts can call.' }];
      },
    });
  }

  it('puts the user policy back even though the plan never touched DND', async () => {
    const original = __getMockPolicy();
    const snapshots = createInMemorySnapshotStore();

    await brightnessOnlyContextWithPriority(snapshots);
    expect(__getMockPolicy()).not.toEqual(original);
    expect(await snapshots.forSession(SESSION)).toHaveLength(1); // brightness only

    const end = await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));

    expect(__getMockPolicy()).toEqual(original);
    expect(__getMockSavedPolicy()).toBeNull();
    expect(end.state).toBe('IDLE');
  });

  it('reports it as a row, so it is counted rather than done silently', async () => {
    const snapshots = createInMemorySnapshotStore();
    await brightnessOnlyContextWithPriority(snapshots);

    const end = await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));

    const policyRow = end.results.find((r) => r.capability === 'dnd');
    expect(policyRow?.status).toBe('restored');
    expect(end.summary.total).toBe(2);
  });

  it('survives a process death, because the saved copy is not in the heap', async () => {
    const original = __getMockPolicy();
    const snapshots = createInMemorySnapshotStore();

    await brightnessOnlyContextWithPriority(snapshots);
    __simulateProcessDeath();

    await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));
    expect(__getMockPolicy()).toEqual(original);
  });

  it('a failure keeps the session retryable rather than reporting a clean end', async () => {
    const snapshots = createInMemorySnapshotStore();
    await brightnessOnlyContextWithPriority(snapshots);

    __setMockPermission('notification_policy', false);
    const blocked = await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));

    expect(blocked.results.find((r) => r.capability === 'dnd')?.status).toBe('permission_needed');
    expect(blocked.state).toBe('PARTIAL');
    expect(blocked.retryable).toBe(true);
    expect(blocked.cleared).toBe(false);
    // The saved copy is retained: that IS the retry.
    expect(__getMockSavedPolicy()).not.toBeNull();

    __setMockPermission('notification_policy', true);
    const retry = await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));
    expect(retry.state).toBe('IDLE');
    expect(__getMockSavedPolicy()).toBeNull();
  });

  it('adds no row when the context never borrowed a policy', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([brightnessAction(40)]), deps(snapshots, mockBorrowedPolicy));
    const end = await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));

    expect(end.results.map((r) => r.capability)).toEqual(['brightness']);
  });

  it('does not double up when a dnd row already carries the policy', async () => {
    const original = __getMockPolicy();
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      ...deps(snapshots, mockBorrowedPolicy),
      applyPriority: async () => {
        __applyMockPriorityPolicy(true, false);
        return null;
      },
    });

    const end = await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));

    // One dnd row, from the snapshot walk. The fallback stays out of the way.
    expect(end.results.filter((r) => r.capability === 'dnd')).toHaveLength(1);
    expect(__getMockPolicy()).toEqual(original);
  });

  it('a port that throws is contained — the rest of the restore still runs', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();
    const exploding: BorrowedPolicy = {
      hasSaved: () => true,
      restore: () => {
        throw new Error('policy store unreadable');
      },
    };

    await executePlan(plan([brightnessAction(40)]), { registry: mockRegistry, snapshots });
    const end = await endContext(SESSION, deps(snapshots, exploding));

    expect(__getMockBrightnessRaw()).toBe(187); // brightness still went back
    expect(end.results.find((r) => r.capability === 'dnd')?.status).toBe('failed');
    expect(end.state).toBe('PARTIAL');
  });
});

// ---------------------------------------------------------------------------
// A3.1 — the audit, expressed as assertions
// ---------------------------------------------------------------------------

describe('A3.1 — every capability that changes user state is restorable', () => {
  it('dnd and brightness capture a value; alarm deliberately does not', async () => {
    const snapshots = createInMemorySnapshotStore();

    await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        brightnessAction(40),
        action({ capability: 'alarm', value: '07:00', requiredPermission: 'exact_alarm' }),
      ]),
      { registry: mockRegistry, snapshots },
    );

    const captured = (await snapshots.forSession(SESSION)).map((r) => r.capability).sort();
    expect(captured).toEqual(['brightness', 'dnd']);
    // An alarm the user asked for is not collateral of the context, so there is nothing to undo.
    expect(captured).not.toContain('alarm');
  });

  it('a policy Ally never wrote is never claimed as restored', async () => {
    __setMockPolicy({
      priorityCategories: 42,
      priorityCallSenders: 1,
      priorityMessageSenders: 1,
      suppressedVisualEffects: 7,
      priorityConversationSenders: 2,
    });
    const untouched = __getMockPolicy();
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([brightnessAction(40)]), deps(snapshots, mockBorrowedPolicy));
    const end = await endContext(SESSION, deps(snapshots, mockBorrowedPolicy));

    expect(__getMockPolicy()).toEqual(untouched);
    expect(end.results.some((r) => r.capability === 'dnd')).toBe(false);
  });
});
