/**
 * OWNER: AAYUSH — task A-V1
 *
 * Covers the ActionPlan -> ActionExecutor -> Capability boundary with no device and no
 * database. Two kinds of double are used deliberately:
 *
 *   mockRegistry   the SHIPPED MockDevice (ADR-007). Proves the executor drives the real
 *                  capability contract, including its read-back, not a test-shaped fake.
 *   stubRegistry   hand-built capabilities for states MockDevice cannot reach —
 *                  unavailable hardware, a capability that fails, one that throws.
 *
 * Nothing here proves Android behaviour. The real-device evidence is in docs/DEVICE_NOTES.md.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type {
  ActionPlan,
  ActionResult,
  Capability,
  CapabilityValue,
  DeviceCapability,
  DeviceRegistry,
  PlannedAction,
} from '../../types';
import {
  mockRegistry,
  __setMockPermission,
  __resetMockState,
  __getMockState,
  __getMockBrightnessPercent,
} from '../../native/MockDevice';
import { executePlan, summarisePlan, createInMemorySnapshotStore, snapshotId } from '../index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function action(overrides: Partial<PlannedAction> & { capability: Capability }): PlannedAction {
  return {
    value: 'priority',
    needsSnapshot: true,
    requiredPermission: 'notification_policy',
    reason: 'test',
    ...overrides,
  };
}

function plan(actions: PlannedAction[], sessionId = 'session-1'): ActionPlan {
  return { sessionId, actions, restoreOnEnd: true };
}

/** A capability with only the behaviour a given test needs; the rest is inert-but-valid. */
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

/** Applies whatever it is given, so a plan row lands as `applied`. */
function applying(capability: Capability): DeviceCapability {
  return stubCapability({
    async execute(value) {
      return {
        capability,
        status: 'applied',
        beforeValue: null,
        afterValue: value,
        message: 'ok',
      };
    },
  });
}

beforeEach(() => {
  __resetMockState();
});

// ---------------------------------------------------------------------------
// Test 1 — valid ActionPlan -> correct capability selected AND executed
// ---------------------------------------------------------------------------

describe('1. capability selection', () => {
  it('routes each planned action to the capability it names, with the planned value', async () => {
    const seen: { capability: Capability; value: CapabilityValue }[] = [];

    const record = (capability: Capability): DeviceCapability =>
      stubCapability({
        async execute(value) {
          seen.push({ capability, value });
          return {
            capability,
            status: 'applied',
            beforeValue: null,
            afterValue: value,
            message: 'ok',
          };
        },
      });

    const results = await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: stubRegistry({ dnd: record('dnd'), brightness: record('brightness') }) },
    );

    expect(seen).toEqual([
      { capability: 'dnd', value: 'priority' },
      { capability: 'brightness', value: 40 },
    ]);
    expect(results.map((r) => r.capability)).toEqual(['dnd', 'brightness']);
  });

  it('executes only what the plan contains — an empty plan touches nothing', async () => {
    const results = await executePlan(plan([]), { registry: mockRegistry });

    expect(results).toEqual([]);
    expect(__getMockState().dnd).toBe('off');
    expect(__getMockBrightnessPercent()).toBe(73);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — unsupported action -> not_supported, no mutation attempted
// ---------------------------------------------------------------------------

describe('2. unsupported actions', () => {
  it('reports not_supported when the capability says it is unavailable', async () => {
    const registry = stubRegistry({
      ringer: stubCapability({
        async isAvailable() {
          return false;
        },
      }),
    });

    const results = await executePlan(plan([action({ capability: 'ringer', value: 'silent' })]), {
      registry,
    });

    expect(results[0]?.status).toBe('not_supported');
  });

  it('never attempts a mutation on an unavailable capability', async () => {
    let executed = false;
    const registry = stubRegistry({
      ringer: stubCapability({
        async isAvailable() {
          return false;
        },
        async execute() {
          executed = true;
          throw new Error('must not be reached');
        },
      }),
    });

    await executePlan(plan([action({ capability: 'ringer', value: 'silent' })]), { registry });

    expect(executed).toBe(false);
  });

  it('rejects a capability outside the allow-list instead of guessing (SRS FR-13)', async () => {
    // A plan is built from a policy that is ultimately fed by model output, so the name is
    // validated at runtime even though the type says it cannot happen.
    const rogue = {
      ...action({ capability: 'dnd' }),
      capability: 'wifi',
    } as unknown as PlannedAction;

    const results = await executePlan(plan([rogue]), { registry: mockRegistry });

    expect(results[0]?.status).toBe('not_supported');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — permission denied -> permission_needed, no mutation attempted
// ---------------------------------------------------------------------------

describe('3. permission gate', () => {
  it('reports permission_needed when the capability lacks its permission', async () => {
    __setMockPermission('notification_policy', false);

    const results = await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
    });

    expect(results[0]?.status).toBe('permission_needed');
  });

  it('attempts NO mutation when permission is missing — the device is left untouched', async () => {
    __setMockPermission('write_settings', false);

    const results = await executePlan(
      plan([action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' })]),
      { registry: mockRegistry },
    );

    expect(results[0]?.status).toBe('permission_needed');
    expect(__getMockBrightnessPercent()).toBe(73);
    // before === after is the visible proof to the user that nothing moved (ADR-007).
    expect(results[0]?.beforeValue).toBe(73);
    expect(results[0]?.afterValue).toBe(73);
  });

  it('does not capture a snapshot for an action it refused to run', async () => {
    __setMockPermission('notification_policy', false);
    const snapshots = createInMemorySnapshotStore();

    await executePlan(plan([action({ capability: 'dnd', needsSnapshot: true })]), {
      registry: mockRegistry,
      snapshots,
    });

    expect(await snapshots.forSession('session-1')).toEqual([]);
  });

  it('flags a plan/capability permission disagreement without changing the verdict', async () => {
    const seen: boolean[] = [];

    const registry = stubRegistry({
      dnd: stubCapability({
        async requiredPermissions() {
          return [
            {
              key: 'write_settings',
              label: 'Modify system settings',
              rationale: '',
              granted: true,
            },
          ];
        },
        async execute(value) {
          return {
            capability: 'dnd',
            status: 'applied',
            beforeValue: null,
            afterValue: value,
            message: 'ok',
          };
        },
      }),
    });

    // The plan declares notification_policy; the capability reports write_settings.
    const results = await executePlan(
      plan([action({ capability: 'dnd', requiredPermission: 'notification_policy' })]),
      {
        registry,
        onProgress: (e) => {
          if (e.phase === 'settled') seen.push(e.declaredPermissionMismatch);
        },
      },
    );

    expect(results[0]?.status).toBe('applied');
    expect(seen).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — capability throws/fails -> failed, executor stays stable
// ---------------------------------------------------------------------------

describe('4. failure handling', () => {
  it('passes a capability-reported failure through unchanged', async () => {
    const registry = stubRegistry({
      dnd: stubCapability({
        async execute() {
          return {
            capability: 'dnd',
            status: 'failed',
            beforeValue: 'off',
            afterValue: 'off',
            message: 'The setting did not take effect.',
          } satisfies ActionResult;
        },
      }),
    });

    const results = await executePlan(plan([action({ capability: 'dnd' })]), { registry });

    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.message).toBe('The setting did not take effect.');
  });

  it('turns a thrown capability error into failed rather than crashing the plan', async () => {
    const registry = stubRegistry({
      dnd: stubCapability({
        async execute() {
          throw new Error('binder transaction failed');
        },
      }),
    });

    const results = await executePlan(plan([action({ capability: 'dnd' })]), { registry });

    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.message).toBe('binder transaction failed');
  });

  it('never upgrades a capability verdict — applied is only ever the capability’s word', async () => {
    const registry = stubRegistry({
      dnd: stubCapability({
        async execute() {
          return {
            capability: 'dnd',
            status: 'not_supported',
            beforeValue: null,
            afterValue: null,
            message: 'nope',
          } satisfies ActionResult;
        },
      }),
    });

    const results = await executePlan(plan([action({ capability: 'dnd' })]), { registry });

    expect(results[0]?.status).toBe('not_supported');
  });
});

// ---------------------------------------------------------------------------
// Test 5 — successful capability -> applied
// ---------------------------------------------------------------------------

describe('5. successful execution', () => {
  it('reports applied and the device actually changed', async () => {
    const results = await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry },
    );

    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(__getMockState().dnd).toBe('priority');
    expect(__getMockBrightnessPercent()).toBe(40);
    expect(results[0]?.beforeValue).toBe('off');
    expect(results[0]?.afterValue).toBe('priority');
    expect(summarisePlan(results).state).toBe('ACTIVE');
  });

  it('captures the pre-change value for every action marked needsSnapshot', async () => {
    const snapshots = createInMemorySnapshotStore();

    await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority', needsSnapshot: true }),
        action({
          capability: 'brightness',
          value: 40,
          needsSnapshot: false,
          requiredPermission: 'write_settings',
        }),
      ]),
      { registry: mockRegistry, snapshots, now: () => 1_000 },
    );

    expect(await snapshots.forSession('session-1')).toEqual([
      {
        id: snapshotId('session-1', 'dnd'),
        sessionId: 'session-1',
        capability: 'dnd',
        previousValue: 'off',
        capturedAt: 1_000,
      },
    ]);
  });

  it('keeps the FIRST snapshot when a capability is applied twice in one session', async () => {
    const snapshots = createInMemorySnapshotStore();
    const deps = { registry: mockRegistry, snapshots, now: () => 1_000 };

    await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), deps);
    await executePlan(plan([action({ capability: 'dnd', value: 'total_silence' })]), deps);

    // Not "priority" — restoring to a value Ally itself set is the ADR-110 bug.
    const rows = await snapshots.forSession('session-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.previousValue).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// Test 6 — multiple actions -> deterministic execution order
// ---------------------------------------------------------------------------

describe('6. ordering', () => {
  it('executes in plan order, sequentially, with one result per action in that order', async () => {
    const order: string[] = [];

    const trace = (capability: Capability): DeviceCapability =>
      stubCapability({
        async execute(value) {
          order.push(`start:${capability}`);
          await new Promise((resolve) => setTimeout(resolve, capability === 'dnd' ? 20 : 0));
          order.push(`end:${capability}`);
          return {
            capability,
            status: 'applied',
            beforeValue: null,
            afterValue: value,
            message: 'ok',
          };
        },
      });

    const results = await executePlan(
      plan([
        action({ capability: 'dnd' }),
        action({ capability: 'brightness', value: 40 }),
        action({ capability: 'ringer', value: 'silent' }),
      ]),
      {
        registry: stubRegistry({
          dnd: trace('dnd'),
          brightness: trace('brightness'),
          ringer: trace('ringer'),
        }),
      },
    );

    // Sequential: dnd finishes before brightness starts, despite being the slow one.
    expect(order).toEqual([
      'start:dnd',
      'end:dnd',
      'start:brightness',
      'end:brightness',
      'start:ringer',
      'end:ringer',
    ]);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.capability)).toEqual(['dnd', 'brightness', 'ringer']);
  });

  it('emits pending then running then settled for each action, in index order', async () => {
    const events: string[] = [];

    await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, onProgress: (e) => events.push(`${e.index}:${e.phase}`) },
    );

    expect(events).toEqual([
      '0:pending',
      '0:running',
      '0:settled',
      '1:pending',
      '1:running',
      '1:settled',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — one action fails in a multi-action plan -> overall PARTIAL
// ---------------------------------------------------------------------------

describe('7. partial execution', () => {
  it('does not abort the plan when an action fails partway through', async () => {
    const registry = stubRegistry({
      dnd: stubCapability({
        async execute() {
          throw new Error('boom');
        },
      }),
      brightness: applying('brightness'),
    });

    const results = await executePlan(
      plan([action({ capability: 'dnd' }), action({ capability: 'brightness', value: 40 })]),
      { registry },
    );

    expect(results.map((r) => r.status)).toEqual(['failed', 'applied']);
    expect(summarisePlan(results).state).toBe('PARTIAL');
  });

  it('calls the real Study shape PARTIAL — dnd + brightness applied, ringer not_supported', async () => {
    const registry = stubRegistry({
      dnd: applying('dnd'),
      brightness: applying('brightness'),
      ringer: stubCapability({
        async isAvailable() {
          return false;
        },
      }),
    });

    const results = await executePlan(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
        action({ capability: 'ringer', value: 'silent' }),
      ]),
      { registry },
    );

    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'not_supported']);

    const summary = summarisePlan(results);
    expect(summary.state).toBe('PARTIAL');
    expect(summary.total).toBe(3);
    expect(summary.byStatus.applied).toBe(2);
    expect(summary.byStatus.not_supported).toBe(1);
  });

  it('reports ERROR when nothing applied, and never rounds it to success', async () => {
    __setMockPermission('notification_policy', false);
    __setMockPermission('write_settings', false);

    const results = await executePlan(
      plan([
        action({ capability: 'dnd' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry },
    );

    const summary = summarisePlan(results);
    expect(summary.state).toBe('ERROR');
    expect(summary.byStatus.permission_needed).toBe(2);
    expect(summary.byStatus.applied).toBe(0);
  });
});
