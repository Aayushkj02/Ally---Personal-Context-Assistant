/**
 * OWNER: AAYUSH — task A-V2
 *
 * The restore half of the context lifecycle: snapshot readback, LIFO ordering, exact value
 * restoration, and what happens to the rows when it does not fully work.
 *
 * The brightness cases are the point of this file. `MockDevice` models the device's RAW value
 * with the percent derived from it, exactly as Android does, so the ADR-116 failure is
 * reproducible here without a phone: raw 187 reports as 73%, and 73% converts back to 186.
 * A restore that comes back 186 has lost the user's setting, quietly, by one unit.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type { ActionResult, Capability, DeviceCapability, DeviceRegistry } from '../../types';
import {
  mockRegistry,
  __setMockPermission,
  __resetMockState,
  __getMockState,
  __getMockBrightnessRaw,
  __getMockBrightnessPercent,
  __setMockBrightnessRaw,
  __simulateProcessDeath,
} from '../../native/MockDevice';
import {
  executePlan,
  restoreSession,
  lifoOrder,
  summariseRestore,
  createInMemorySnapshotStore,
  buildSnapshot,
  type SnapshotStore,
} from '../index';
import type { ActionPlan, PlannedAction } from '../../types';

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

function plan(actions: PlannedAction[], sessionId = SESSION): ActionPlan {
  return { sessionId, actions, restoreOnEnd: true };
}

function stubCapability(overrides: Partial<DeviceCapability>): DeviceCapability {
  return {
    async isAvailable() {
      return true;
    },
    async requiredPermissions() {
      return [];
    },
    async snapshot() {
      return null;
    },
    async execute() {
      throw new Error('execute not stubbed');
    },
    async restore() {
      throw new Error('restore not stubbed');
    },
    ...overrides,
  };
}

function stubRegistry(map: Partial<Record<Capability, DeviceCapability>>): DeviceRegistry {
  return {
    backend: 'mock',
    get(capability) {
      const found = map[capability];
      if (!found) throw new Error(`no stub for ${capability}`);
      return found;
    },
    async openSettingsFor() {},
  };
}

/** Seeds a store directly, so ordering tests do not depend on how execution produced the rows. */
async function seed(
  store: SnapshotStore,
  rows: { capability: Capability; previousValue: string | number | null; at: number }[],
): Promise<void> {
  for (const r of rows) {
    await store.save(buildSnapshot(SESSION, r.capability, r.previousValue, r.at));
  }
}

beforeEach(() => {
  __resetMockState();
});

// ---------------------------------------------------------------------------
// 1. Single snapshot restores correctly
// ---------------------------------------------------------------------------

describe('1. single snapshot', () => {
  it('puts the one captured value back and reports restored', async () => {
    const snapshots = createInMemorySnapshotStore();

    await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });
    expect(__getMockState().dnd).toBe('priority');

    const results = await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('restored');
    expect(__getMockState().dnd).toBe('off');
    expect(summariseRestore(results).state).toBe('IDLE');
  });
});

// ---------------------------------------------------------------------------
// 2. Multiple snapshots restore in LIFO order
// ---------------------------------------------------------------------------

describe('2. LIFO ordering', () => {
  it('restores in the reverse of capture order', async () => {
    const snapshots = createInMemorySnapshotStore();
    await seed(snapshots, [
      { capability: 'dnd', previousValue: 'off', at: 100 },
      { capability: 'brightness', previousValue: 73, at: 200 },
      { capability: 'ringer', previousValue: 'normal', at: 300 },
    ]);

    const order: Capability[] = [];
    const trace = (capability: Capability): DeviceCapability =>
      stubCapability({
        async restore(previous) {
          order.push(capability);
          return {
            capability,
            status: 'restored',
            beforeValue: null,
            afterValue: previous,
            message: 'ok',
          };
        },
      });

    await restoreSession(SESSION, {
      registry: stubRegistry({
        dnd: trace('dnd'),
        brightness: trace('brightness'),
        ringer: trace('ringer'),
      }),
      snapshots,
    });

    expect(order).toEqual(['ringer', 'brightness', 'dnd']);
  });

  it('breaks capturedAt ties by reverse storage order, not by database chance', () => {
    // A frozen test clock makes every row share a timestamp. Order must still be defined.
    const rows = [
      buildSnapshot(SESSION, 'dnd', 'off', 1000),
      buildSnapshot(SESSION, 'brightness', 73, 1000),
      buildSnapshot(SESSION, 'ringer', 'normal', 1000),
    ];

    expect(lifoOrder(rows).map((r) => r.capability)).toEqual(['ringer', 'brightness', 'dnd']);
  });

  it('still orders correctly when timestamps are out of step with storage order', () => {
    const rows = [
      buildSnapshot(SESSION, 'dnd', 'off', 500),
      buildSnapshot(SESSION, 'brightness', 73, 900),
    ];

    expect(lifoOrder(rows).map((r) => r.capability)).toEqual(['brightness', 'dnd']);
  });
});

// ---------------------------------------------------------------------------
// 3. Exact brightness value restores  (the A-V2 headline)
// ---------------------------------------------------------------------------

describe('3. exact brightness restoration', () => {
  it('returns the EXACT raw value, not one reconstructed from the percent', async () => {
    __setMockBrightnessRaw(187);
    expect(__getMockBrightnessPercent()).toBe(73);

    const snapshots = createInMemorySnapshotStore();
    await executePlan(
      plan([action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' })]),
      { registry: mockRegistry, snapshots },
    );
    expect(__getMockBrightnessRaw()).toBe(102);

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    // 73% -> toRaw() would be 186. Anything but 187 means the user's setting was lost.
    expect(__getMockBrightnessRaw()).toBe(187);
  });

  it('the percent alone is genuinely lossy — this is what makes the exact value necessary', () => {
    const RAW_MAX = 255;
    const percent = Math.round((187 * 100) / RAW_MAX);
    expect(percent).toBe(73);
    expect(Math.round((percent * RAW_MAX) / 100)).toBe(186); // not 187
  });
});

// ---------------------------------------------------------------------------
// 12. Persistent brightness metadata survives process recreation
// ---------------------------------------------------------------------------

describe('12. durability across process death', () => {
  it('restores the exact raw value after the app process has died and come back', async () => {
    __setMockBrightnessRaw(187);

    const snapshots = createInMemorySnapshotStore();
    await executePlan(
      plan([action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' })]),
      { registry: mockRegistry, snapshots },
    );
    expect(__getMockBrightnessRaw()).toBe(102);

    // The app is killed and reopened. The device keeps its settings; Ally loses its heap.
    __simulateProcessDeath();

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    // If the snapshot metadata lived in the heap this would be 186.
    expect(__getMockBrightnessRaw()).toBe(187);
  });
});

// ---------------------------------------------------------------------------
// 4. A capability that never executed has no snapshot
// ---------------------------------------------------------------------------

describe('4. unexecuted actions', () => {
  it('writes no snapshot for an unsupported capability, so restore never touches it', async () => {
    const snapshots = createInMemorySnapshotStore();

    const registry = stubRegistry({
      dnd: stubCapability({
        async snapshot() {
          return 'off';
        },
        async execute(value) {
          return {
            capability: 'dnd',
            status: 'applied',
            beforeValue: 'off',
            afterValue: value,
            message: 'ok',
          };
        },
        async restore(previous) {
          return {
            capability: 'dnd',
            status: 'restored',
            beforeValue: null,
            afterValue: previous,
            message: 'ok',
          };
        },
      }),
      ringer: stubCapability({
        async isAvailable() {
          return false;
        },
      }),
    });

    await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'ringer', value: 'silent' }),
      ]),
      { registry, snapshots },
    );

    expect((await snapshots.forSession(SESSION)).map((r) => r.capability)).toEqual(['dnd']);

    const results = await restoreSession(SESSION, { registry, snapshots });
    expect(results.map((r) => r.capability)).toEqual(['dnd']);
  });
});

// ---------------------------------------------------------------------------
// 5. Permission failure during restore -> PARTIAL
// ---------------------------------------------------------------------------

describe('5. permission failure', () => {
  it('reports permission_needed and the whole restore as PARTIAL', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, snapshots },
    );

    // The user revokes the permission while the context is running.
    __setMockPermission('write_settings', false);

    const results = await restoreSession(SESSION, { registry: mockRegistry, snapshots });
    const summary = summariseRestore(results);

    expect(summary.state).toBe('PARTIAL');
    expect(summary.byStatus.permission_needed).toBe(1);
    expect(summary.byStatus.restored).toBe(1);
    // The one it could do, it did. DND is back even though brightness is stuck.
    expect(__getMockState().dnd).toBe('off');
    expect(__getMockBrightnessRaw()).toBe(102);
  });

  it('attempts no write when the permission is missing', async () => {
    const snapshots = createInMemorySnapshotStore();
    await seed(snapshots, [{ capability: 'brightness', previousValue: 73, at: 100 }]);

    __setMockBrightnessRaw(102);
    __setMockPermission('write_settings', false);

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(__getMockBrightnessRaw()).toBe(102);
  });
});

// ---------------------------------------------------------------------------
// 6. One failed restore does not stop later restores
// ---------------------------------------------------------------------------

describe('6. failure isolation', () => {
  it('keeps going after a capability throws mid-walk', async () => {
    const snapshots = createInMemorySnapshotStore();
    await seed(snapshots, [
      { capability: 'dnd', previousValue: 'off', at: 100 },
      { capability: 'brightness', previousValue: 73, at: 200 },
    ]);

    let dndRestored = false;
    const registry = stubRegistry({
      // Restored SECOND under LIFO, so it proves the walk survived the earlier throw.
      dnd: stubCapability({
        async restore(previous) {
          dndRestored = true;
          return {
            capability: 'dnd',
            status: 'restored',
            beforeValue: null,
            afterValue: previous,
            message: 'ok',
          };
        },
      }),
      brightness: stubCapability({
        async restore() {
          throw new Error('binder transaction failed');
        },
      }),
    });

    const results = await restoreSession(SESSION, { registry, snapshots });

    expect(results.map((r) => r.status)).toEqual(['failed', 'restored']);
    expect(results[0]?.message).toBe('binder transaction failed');
    expect(dndRestored).toBe(true);
    expect(summariseRestore(results).state).toBe('PARTIAL');
  });
});

// ---------------------------------------------------------------------------
// 7. Alarm / skipped capability
// ---------------------------------------------------------------------------

describe('7. one-shot capabilities', () => {
  it('treats a capability with nothing to put back as skipped, and skipped is still clean', async () => {
    const snapshots = createInMemorySnapshotStore();
    await seed(snapshots, [{ capability: 'alarm', previousValue: null, at: 100 }]);

    const results = await restoreSession(SESSION, { registry: mockRegistry, snapshots });
    const summary = summariseRestore(results);

    expect(results[0]?.status).toBe('skipped');
    // An alarm the user asked for is not collateral of the context ending.
    expect(summary.state).toBe('IDLE');
    expect(summary.safeToClear).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Empty session
// ---------------------------------------------------------------------------

describe('8. empty session', () => {
  it('is a no-op that touches nothing and ends the context cleanly', async () => {
    const snapshots = createInMemorySnapshotStore();

    const results = await restoreSession('session-with-nothing', {
      registry: mockRegistry,
      snapshots,
    });

    expect(results).toEqual([]);
    expect(__getMockState().dnd).toBe('off');
    expect(summariseRestore(results).state).toBe('IDLE');
  });
});

// ---------------------------------------------------------------------------
// 9 & 10. Retention: clear only after a clean sweep
// ---------------------------------------------------------------------------

describe('9/10. snapshot retention', () => {
  it('a clean restore is safeToClear, and clear() actually empties the session', async () => {
    const snapshots = createInMemorySnapshotStore();

    await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    const results = await restoreSession(SESSION, { registry: mockRegistry, snapshots });
    const summary = summariseRestore(results);

    expect(summary.safeToClear).toBe(true);
    // restoreSession itself must NOT have cleared them — that is the caller's decision.
    expect(await snapshots.forSession(SESSION)).toHaveLength(1);

    await snapshots.clear(SESSION);
    expect(await snapshots.forSession(SESSION)).toEqual([]);
  });

  it('a partial restore is NOT safeToClear and keeps every row for the retry', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, snapshots },
    );

    __setMockPermission('write_settings', false);
    const summary = summariseRestore(
      await restoreSession(SESSION, { registry: mockRegistry, snapshots }),
    );

    expect(summary.state).toBe('PARTIAL');
    expect(summary.safeToClear).toBe(false);
    // Both rows survive, including the one that already restored — retry re-applies it harmlessly.
    expect(await snapshots.forSession(SESSION)).toHaveLength(2);
  });

  it('a retry after the permission is restored finishes the job exactly', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();

    await executePlan(
      plan([action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' })]),
      { registry: mockRegistry, snapshots },
    );

    __setMockPermission('write_settings', false);
    expect(
      summariseRestore(await restoreSession(SESSION, { registry: mockRegistry, snapshots })).state,
    ).toBe('PARTIAL');

    __setMockPermission('write_settings', true);
    const retry = summariseRestore(
      await restoreSession(SESSION, { registry: mockRegistry, snapshots }),
    );

    expect(retry.state).toBe('IDLE');
    expect(__getMockBrightnessRaw()).toBe(187);
  });
});

// ---------------------------------------------------------------------------
// 11. Snapshot data is not overwritten by later writes
// ---------------------------------------------------------------------------

describe('11. snapshot immutability', () => {
  it('a second capture in the same session never replaces the original value', async () => {
    const snapshots = createInMemorySnapshotStore();
    const deps = { registry: mockRegistry, snapshots };

    await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), deps);
    await executePlan(plan([action({ capability: 'dnd', value: 'total_silence' })]), deps);

    const rows = await snapshots.forSession(SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.previousValue).toBe('off');

    await restoreSession(SESSION, deps);

    // 'off' — the state before Ally arrived — not 'priority', which Ally set itself.
    expect(__getMockState().dnd).toBe('off');
  });

  it('restores brightness to the pre-Ally raw value even after several changes', async () => {
    __setMockBrightnessRaw(187);
    const snapshots = createInMemorySnapshotStore();
    const deps = { registry: mockRegistry, snapshots };
    const bright = (v: number) =>
      plan([action({ capability: 'brightness', value: v, requiredPermission: 'write_settings' })]);

    await executePlan(bright(40), deps);
    await executePlan(bright(10), deps);
    await executePlan(bright(90), deps);

    await restoreSession(SESSION, deps);

    expect(__getMockBrightnessRaw()).toBe(187);
  });
});

// ---------------------------------------------------------------------------
// Result vocabulary
// ---------------------------------------------------------------------------

describe('result vocabulary', () => {
  it('reports an unavailable capability as not_supported rather than inventing a status', async () => {
    const snapshots = createInMemorySnapshotStore();
    await seed(snapshots, [{ capability: 'ringer', previousValue: 'normal', at: 100 }]);

    const results = await restoreSession(SESSION, {
      registry: stubRegistry({
        ringer: stubCapability({
          async isAvailable() {
            return false;
          },
        }),
      }),
      snapshots,
    });

    expect(results[0]?.status).toBe('not_supported');
    expect(summariseRestore(results).state).toBe('PARTIAL');
  });

  it('never claims a clean end when any row failed', async () => {
    const mixed: ActionResult[] = [
      { capability: 'dnd', status: 'restored', beforeValue: null, afterValue: 'off', message: '' },
      {
        capability: 'brightness',
        status: 'failed',
        beforeValue: null,
        afterValue: null,
        message: '',
      },
    ];

    expect(summariseRestore(mixed).state).toBe('PARTIAL');
    expect(summariseRestore(mixed).safeToClear).toBe(false);
  });
});
