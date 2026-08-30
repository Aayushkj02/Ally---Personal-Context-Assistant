/**
 * OWNER: AAYUSH — task A-V3
 *
 * The context lifecycle end to end on the device side: START → ACTIVE → END → IDLE, plus every
 * way it can fall short of that.
 *
 * The coordinator composes `executePlan()` and `restoreSession()`, both of which have their own
 * suites. These tests are about the things only the coordinator can get wrong: claiming ACTIVE
 * when nothing applied, dropping snapshots after a restore that half-worked, and needing
 * process-local state to know what to put back.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type {
  ActionPlan,
  Capability,
  ChannelEnforcement,
  DeviceCapability,
  DeviceRegistry,
  PlannedAction,
} from '../../types';
import {
  mockRegistry,
  __setMockPermission,
  __resetMockState,
  __getMockState,
  __getMockBrightnessRaw,
  __setMockBrightnessRaw,
  __simulateProcessDeath,
} from '../../native/MockDevice';
import {
  startContext,
  endContext,
  restoreContext,
  createInMemorySnapshotStore,
  type LifecycleHooks,
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

function plan(actions: PlannedAction[], sessionId = SESSION): ActionPlan {
  return { sessionId, actions, restoreOnEnd: true };
}

/** The real Study shape: dnd + brightness + a ringer that this device cannot do. */
function studyPlan(): ActionPlan {
  return plan([
    action({ capability: 'dnd', value: 'priority' }),
    action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
    action({ capability: 'ringer', value: 'silent' }),
  ]);
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

/** Records which hooks fired, in order — this is the seam Dhrey will connect to. */
function recordingHooks(): { calls: string[]; hooks: LifecycleHooks } {
  const calls: string[] = [];
  return {
    calls,
    hooks: {
      onStarted: (id) => void calls.push(`started:${id}`),
      onActivated: (id, state) => void calls.push(`activated:${state}`),
      onFailed: () => void calls.push('failed'),
      onPartial: () => void calls.push('partial'),
      onEnded: (_id, state) => void calls.push(`ended:${state}`),
    },
  };
}

/**
 * The unavailable-ringer registry, matching the real device: dnd and brightness work through
 * MockDevice, ringer reports unavailable the way pendingCapability does until T5.
 */
function studyRegistry(): DeviceRegistry {
  return {
    backend: 'mock',
    get(capability) {
      if (capability === 'ringer') {
        return stubCapability({
          async isAvailable() {
            return false;
          },
        });
      }
      return mockRegistry.get(capability);
    },
    async openSettingsFor() {},
  };
}

beforeEach(() => {
  __resetMockState();
});

// ---------------------------------------------------------------------------
// 1 & 2. Start context executes the plan and reports ACTIVE
// ---------------------------------------------------------------------------

describe('1/2. startContext', () => {
  it('executes the plan through the executor and changes the device', async () => {
    const snapshots = createInMemorySnapshotStore();

    const result = await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, snapshots },
    );

    expect(result.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(__getMockState().dnd).toBe('priority');
    expect(result.sessionId).toBe(SESSION);
  });

  it('reports ACTIVE and fires onActivated when everything applied', async () => {
    const { calls, hooks } = recordingHooks();
    const snapshots = createInMemorySnapshotStore();

    const result = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
      hooks,
    });

    expect(result.state).toBe('ACTIVE');
    expect(calls).toEqual([`started:${SESSION}`, 'activated:ACTIVE']);
  });

  it('captures snapshots as a side effect of starting, ready for the end', async () => {
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    const rows = await snapshots.forSession(SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.previousValue).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// 3. Fully failed execution does not report ACTIVE
// ---------------------------------------------------------------------------

describe('3. total failure', () => {
  it('reports ERROR, never ACTIVE, when nothing applied', async () => {
    const { calls, hooks } = recordingHooks();
    __setMockPermission('notification_policy', false);
    __setMockPermission('write_settings', false);

    const result = await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, snapshots: createInMemorySnapshotStore(), hooks },
    );

    expect(result.state).toBe('ERROR');
    expect(calls).toEqual([`started:${SESSION}`, 'failed']);
    // onActivated must NOT have fired: the session stays READY because nothing moved.
    expect(calls).not.toContain('activated:ERROR');
  });

  it('leaves the device untouched when every action was refused', async () => {
    __setMockPermission('notification_policy', false);

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    expect(__getMockState().dnd).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// 4. Partial execution reports PARTIAL
// ---------------------------------------------------------------------------

describe('4. partial execution', () => {
  it('keeps the real Study shape as PARTIAL rather than rounding it to success', async () => {
    const { calls, hooks } = recordingHooks();

    const result = await startContext(studyPlan(), {
      registry: studyRegistry(),
      snapshots: createInMemorySnapshotStore(),
      hooks,
    });

    expect(result.results.map((r) => r.status)).toEqual(['applied', 'applied', 'not_supported']);
    expect(result.state).toBe('PARTIAL');
    // Activated, carrying PARTIAL. onPartial is deliberately NOT fired on the apply path: a
    // caller that wires it to endSession() would otherwise end the session it just started.
    expect(calls).toEqual([`started:${SESSION}`, 'activated:PARTIAL']);
    expect(calls).not.toContain('partial');
  });
});

// ---------------------------------------------------------------------------
// Regression: a partial APPLY must not look like a partial RESTORE
// ---------------------------------------------------------------------------

describe('hook scoping', () => {
  it('a partial apply does not fire the hook a caller wires to endSession()', async () => {
    // Found on device. The harness wires onPartial -> endSession(), so firing it from
    // startContext() ended the session that had just been started, and the subsequent
    // endContext() reported "no active context to end". The apply path must never fire it.
    const ended: string[] = [];
    const snapshots = createInMemorySnapshotStore();

    await startContext(studyPlan(), {
      registry: studyRegistry(),
      snapshots,
      hooks: { onPartial: (id) => void ended.push(id) },
    });

    expect(ended).toEqual([]);
  });

  it('but a partial RESTORE does fire it', async () => {
    const ended: string[] = [];
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    __setMockPermission('notification_policy', false);
    await endContext(SESSION, {
      registry: mockRegistry,
      snapshots,
      hooks: { onPartial: (id) => void ended.push(id) },
    });

    expect(ended).toEqual([SESSION]);
  });
});

// ---------------------------------------------------------------------------
// A-V7 — priority is applied with the context, and reported honestly
// ---------------------------------------------------------------------------

describe('A-V7. priority', () => {
  /** What Dhrey's applier returns on this device: calls + sms enforced, whatsapp never. */
  const samsungReport: ChannelEnforcement[] = [
    { channel: 'calls', status: 'enforced', message: 'Starred contacts can call you.' },
    { channel: 'sms', status: 'enforced', message: 'Starred contacts can message you.' },
    {
      channel: 'whatsapp',
      status: 'preference_only',
      message: 'Ally remembers this. Android cannot let Ally control WhatsApp notifications.',
    },
  ];

  it('applies priority once the plan has changed something, and returns the per-channel result', async () => {
    let calls = 0;
    const result = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
      applyPriority: async () => {
        calls += 1;
        return samsungReport;
      },
    });

    expect(calls).toBe(1);
    expect(result.priority).toEqual(samsungReport);
  });

  it('never reports WhatsApp as enforced — the applier is the only source of that verdict', async () => {
    const result = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
      applyPriority: async () => samsungReport,
    });

    const byChannel = new Map(result.priority?.map((c) => [c.channel, c.status]));
    expect(byChannel.get('calls')).toBe('enforced');
    expect(byChannel.get('sms')).toBe('enforced');
    expect(byChannel.get('whatsapp')).toBe('preference_only');
  });

  it('keeps the priority result separate from the plan status', async () => {
    // The plan is PARTIAL (ringer unsupported) while calls/sms are enforced. Collapsing the
    // two would lose one of the facts the user needs.
    const result = await startContext(studyPlan(), {
      registry: studyRegistry(),
      snapshots: createInMemorySnapshotStore(),
      applyPriority: async () => samsungReport,
    });

    expect(result.state).toBe('PARTIAL');
    expect(result.priority?.find((c) => c.channel === 'calls')?.status).toBe('enforced');
  });

  it('does NOT touch priority when the plan applied nothing', async () => {
    let calls = 0;
    __setMockPermission('notification_policy', false);

    const result = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
      applyPriority: async () => {
        calls += 1;
        return samsungReport;
      },
    });

    expect(result.state).toBe('ERROR');
    // The device is untouched on a total failure; rewriting the notification policy would
    // break that promise for a context that never started.
    expect(calls).toBe(0);
    expect(result.priority).toBeNull();
  });

  it('a throwing applier does not take the context down with it', async () => {
    const result = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
      applyPriority: async () => {
        throw new Error('binder died');
      },
    });

    expect(result.state).toBe('ACTIVE');
    expect(__getMockState().dnd).toBe('priority');
    expect(result.priority).toBeNull();
  });

  it('is null when no applier is wired, which is not a claim either way', async () => {
    const result = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    expect(result.priority).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. End context restores
// ---------------------------------------------------------------------------

describe('5. endContext', () => {
  it('puts the device back and reports IDLE', async () => {
    const { calls, hooks } = recordingHooks();
    const snapshots = createInMemorySnapshotStore();
    __setMockBrightnessRaw(187);

    await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, snapshots, hooks },
    );

    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots, hooks });

    expect(ended.state).toBe('IDLE');
    expect(__getMockState().dnd).toBe('off');
    expect(__getMockBrightnessRaw()).toBe(187);
    expect(calls).toEqual([`started:${SESSION}`, 'activated:ACTIVE', 'ended:IDLE']);
  });

  it('restores in LIFO order — the reverse of application', async () => {
    const snapshots = createInMemorySnapshotStore();
    const order: Capability[] = [];

    const trace = (capability: Capability): DeviceCapability =>
      stubCapability({
        async snapshot() {
          return 'x';
        },
        async execute(value) {
          return {
            capability,
            status: 'applied',
            beforeValue: 'x',
            afterValue: value,
            message: 'ok',
          };
        },
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

    const registry = stubRegistry({
      dnd: trace('dnd'),
      brightness: trace('brightness'),
      ringer: trace('ringer'),
    });

    await startContext(
      plan([
        action({ capability: 'dnd' }),
        action({ capability: 'brightness', value: 40 }),
        action({ capability: 'ringer', value: 'silent' }),
      ]),
      { registry, snapshots },
    );

    await endContext(SESSION, { registry, snapshots });

    expect(order).toEqual(['ringer', 'brightness', 'dnd']);
  });
});

// ---------------------------------------------------------------------------
// 6 & 7. Clearing is gated on a clean restore
// ---------------------------------------------------------------------------

describe('6/7. snapshot retention', () => {
  it('clears the snapshots after a completely successful restore', async () => {
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots });

    expect(ended.cleared).toBe(true);
    expect(ended.retryable).toBe(false);
    expect(await snapshots.forSession(SESSION)).toEqual([]);
  });

  it('RETAINS every snapshot when the restore was only partial', async () => {
    const snapshots = createInMemorySnapshotStore();
    __setMockBrightnessRaw(187);

    await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, snapshots },
    );

    // The user revokes the permission while the context is running.
    __setMockPermission('write_settings', false);
    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots });

    expect(ended.state).toBe('PARTIAL');
    expect(ended.cleared).toBe(false);
    expect(ended.retryable).toBe(true);
    // Both rows survive — including the one that already went back.
    expect(await snapshots.forSession(SESSION)).toHaveLength(2);
  });

  it('honours keepSnapshots even on a clean restore', async () => {
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    const ended = await endContext(
      SESSION,
      { registry: mockRegistry, snapshots },
      { keepSnapshots: true },
    );

    expect(ended.state).toBe('IDLE');
    expect(ended.cleared).toBe(false);
    expect(await snapshots.forSession(SESSION)).toHaveLength(1);
  });

  it('fires onPartial rather than onEnded when the restore fell short', async () => {
    const { calls, hooks } = recordingHooks();
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    __setMockPermission('notification_policy', false);
    await endContext(SESSION, { registry: mockRegistry, snapshots, hooks });

    expect(calls).toEqual(['partial']);
    expect(calls).not.toContain('ended:IDLE');
  });
});

// ---------------------------------------------------------------------------
// 8. Retry after a partial restore
// ---------------------------------------------------------------------------

describe('8. retry', () => {
  it('finishes the job exactly once the permission comes back', async () => {
    const snapshots = createInMemorySnapshotStore();
    __setMockBrightnessRaw(187);

    await startContext(
      plan([action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' })]),
      { registry: mockRegistry, snapshots },
    );

    __setMockPermission('write_settings', false);
    const first = await endContext(SESSION, { registry: mockRegistry, snapshots });
    expect(first.state).toBe('PARTIAL');
    expect(first.retryable).toBe(true);

    __setMockPermission('write_settings', true);
    const retry = await restoreContext(SESSION, { registry: mockRegistry, snapshots });

    expect(retry.state).toBe('IDLE');
    expect(retry.cleared).toBe(true);
    // Exact, not reconstructed from the percent — the retry did not degrade the value.
    expect(__getMockBrightnessRaw()).toBe(187);
  });

  it('never captures a new snapshot during a restore, however many attempts it takes', async () => {
    const snapshots = createInMemorySnapshotStore();

    await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    __setMockPermission('notification_policy', false);
    await endContext(SESSION, { registry: mockRegistry, snapshots });
    await endContext(SESSION, { registry: mockRegistry, snapshots });

    const rows = await snapshots.forSession(SESSION);
    expect(rows).toHaveLength(1);
    // Still the pre-Ally value after two failed attempts, not something Ally set.
    expect(rows[0]?.previousValue).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// 9. Process restart — no process-local state required
// ---------------------------------------------------------------------------

describe('9. process restart', () => {
  it('restores from the sessionId alone after the process has died', async () => {
    const snapshots = createInMemorySnapshotStore();
    __setMockBrightnessRaw(187);

    await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      { registry: mockRegistry, snapshots },
    );

    // The app dies. Everything the coordinator returned is gone; only the sessionId survives,
    // exactly as it would after reading it back out of the session table.
    __simulateProcessDeath();

    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots });

    expect(ended.state).toBe('IDLE');
    expect(__getMockState().dnd).toBe('off');
    expect(__getMockBrightnessRaw()).toBe(187);
  });

  it('an unknown session is a clean no-op, not an error', async () => {
    const ended = await endContext('never-existed', {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    expect(ended.results).toEqual([]);
    expect(ended.state).toBe('IDLE');
    expect(__getMockState().dnd).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// Hooks are advisory, never load-bearing
// ---------------------------------------------------------------------------

describe('hook isolation', () => {
  it('a throwing hook does not undo or mask a device change that really happened', async () => {
    const snapshots = createInMemorySnapshotStore();

    const result = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
      hooks: {
        onActivated: () => {
          throw new Error('session table unavailable');
        },
      },
    });

    expect(result.state).toBe('ACTIVE');
    expect(__getMockState().dnd).toBe('priority');
  });

  it('works with no hooks wired at all', async () => {
    const snapshots = createInMemorySnapshotStore();

    const started = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });
    const ended = await endContext(SESSION, { registry: mockRegistry, snapshots });

    expect(started.state).toBe('ACTIVE');
    expect(ended.state).toBe('IDLE');
  });
});
