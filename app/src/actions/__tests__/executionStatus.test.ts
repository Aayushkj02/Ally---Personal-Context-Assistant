/**
 * OWNER: AAYUSH — task A-V10
 *
 * That the eight execution outcomes stay eight, all the way to what the user reads.
 *
 * The failure this guards against is not a crash, it is a rounding: `partial` shown as
 * "Success", `not_supported` shown as "Failed", `permission_needed` shown as anything other
 * than a request for permission. Each of those quietly tells the user something untrue about
 * their phone, which is the one thing this codebase is built not to do (PRD §20, NFR-03).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type {
  ActionPlan,
  ActionResult,
  Capability,
  ChannelEnforcement,
  DeviceCapability,
  DeviceRegistry,
  PlannedAction,
} from '../../types';
import { ACTION_STATUSES, ENFORCEMENT_PRESENTATION, STATUS_PRESENTATION } from '../../types';
import {
  mockRegistry,
  __resetMockState,
  __setMockPermission,
  __setMockBrightnessRaw,
} from '../../native/MockDevice';
import { startContext, createInMemorySnapshotStore, summarisePlan } from '../index';

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

function plan(actions: PlannedAction[]): ActionPlan {
  return { sessionId: SESSION, actions, restoreOnEnd: true };
}

function stub(overrides: Partial<DeviceCapability>): DeviceCapability {
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
      throw new Error('not stubbed');
    },
    async restore() {
      throw new Error('not stubbed');
    },
    ...overrides,
  };
}

function registry(map: Partial<Record<Capability, DeviceCapability>>): DeviceRegistry {
  return {
    backend: 'mock',
    get(c) {
      const found = map[c];
      if (!found) throw new Error(`no stub for ${c}`);
      return found;
    },
    async openSettingsFor() {},
  };
}

const applying = (capability: Capability): DeviceCapability =>
  stub({
    async execute(value) {
      return { capability, status: 'applied', beforeValue: null, afterValue: value, message: 'ok' };
    },
  });

const unavailable = (): DeviceCapability =>
  stub({
    async isAvailable() {
      return false;
    },
  });

const failing = (capability: Capability): DeviceCapability =>
  stub({
    async execute() {
      return {
        capability,
        status: 'failed',
        beforeValue: null,
        afterValue: null,
        message: 'Android did not hold it.',
      } satisfies ActionResult;
    },
  });

beforeEach(() => {
  __resetMockState();
});

// ---------------------------------------------------------------------------
// The vocabulary itself
// ---------------------------------------------------------------------------

describe('the status vocabulary is not collapsible', () => {
  it('every ActionStatus has its own label — none share wording', () => {
    const labels = ACTION_STATUSES.map((s) => STATUS_PRESENTATION[s].label);
    expect(new Set(labels).size).toBe(ACTION_STATUSES.length);
  });

  it('not_supported does not read as a failure', () => {
    expect(STATUS_PRESENTATION.not_supported.label).not.toMatch(/fail/i);
    expect(STATUS_PRESENTATION.not_supported.tone).not.toBe('danger');
  });

  it('permission_needed does not read as a success or a failure', () => {
    expect(STATUS_PRESENTATION.permission_needed.label).toMatch(/permission/i);
    expect(STATUS_PRESENTATION.permission_needed.tone).not.toBe('success');
    expect(STATUS_PRESENTATION.permission_needed.tone).not.toBe('danger');
  });

  it('preference_only says remembered, and explicitly not enforced', () => {
    const p = ENFORCEMENT_PRESENTATION.preference_only;
    expect(p.label).toMatch(/remember/i);
    expect(p.label).toMatch(/not enforced/i);
    expect(p.tone).not.toBe('success');
  });

  it('enforced and preference_only are not the same claim', () => {
    expect(ENFORCEMENT_PRESENTATION.enforced.label).not.toBe(
      ENFORCEMENT_PRESENTATION.preference_only.label,
    );
  });
});

// ---------------------------------------------------------------------------
// Each outcome, through the real coordinator
// ---------------------------------------------------------------------------

describe('outcomes reaching the caller', () => {
  it('complete success is ACTIVE', async () => {
    const r = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    expect(r.results[0]?.status).toBe('applied');
    expect(r.state).toBe('ACTIVE');
  });

  it('unsupported is reported as unsupported, and drags the plan to PARTIAL — not FAILED', async () => {
    const r = await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'ringer', value: 'silent' }),
      ]),
      {
        registry: registry({ dnd: applying('dnd'), ringer: unavailable() }),
        snapshots: createInMemorySnapshotStore(),
      },
    );

    expect(r.results.map((x) => x.status)).toEqual(['applied', 'not_supported']);
    expect(r.state).toBe('PARTIAL');
    expect(r.state).not.toBe('ERROR');
  });

  it('permission_required is its own outcome, not a failure', async () => {
    __setMockPermission('write_settings', false);

    const r = await startContext(
      plan([action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' })]),
      { registry: mockRegistry, snapshots: createInMemorySnapshotStore() },
    );

    expect(r.results[0]?.status).toBe('permission_needed');
    expect(r.results[0]?.status).not.toBe('failed');
  });

  it('a native failure is reported as failed', async () => {
    const r = await startContext(plan([action({ capability: 'dnd' })]), {
      registry: registry({ dnd: failing('dnd') }),
      snapshots: createInMemorySnapshotStore(),
    });

    expect(r.results[0]?.status).toBe('failed');
    expect(r.state).toBe('ERROR');
  });

  it('preference_only survives all the way out of startContext', async () => {
    const report: ChannelEnforcement[] = [
      { channel: 'calls', status: 'enforced', message: 'Starred contacts can call you.' },
      { channel: 'sms', status: 'unsupported', message: 'Not requested.' },
      { channel: 'whatsapp', status: 'preference_only', message: 'Remembered, not enforced.' },
    ];

    const r = await startContext(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
      applyPriority: async () => report,
    });

    const byChannel = new Map(r.priority?.map((c) => [c.channel, c.status]));
    expect(byChannel.get('whatsapp')).toBe('preference_only');
    // And it is NOT folded into the plan's own status.
    expect(r.state).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// A mixed plan keeps every distinction at once
// ---------------------------------------------------------------------------

describe('mixed multi-action plan', () => {
  it('keeps applied, permission_needed and not_supported apart in one run', async () => {
    __setMockBrightnessRaw(187);
    __setMockPermission('write_settings', false);

    const r = await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
        action({ capability: 'ringer', value: 'silent' }),
      ]),
      {
        registry: {
          backend: 'mock',
          get(c) {
            return c === 'ringer' ? unavailable() : mockRegistry.get(c);
          },
          async openSettingsFor() {},
        },
        snapshots: createInMemorySnapshotStore(),
      },
    );

    expect(r.results.map((x) => x.status)).toEqual([
      'applied',
      'permission_needed',
      'not_supported',
    ]);

    const summary = summarisePlan(r.results);
    expect(summary.state).toBe('PARTIAL');
    expect(summary.byStatus.applied).toBe(1);
    expect(summary.byStatus.permission_needed).toBe(1);
    expect(summary.byStatus.not_supported).toBe(1);
    // Three different reasons, three different counts — none merged into "1 failed".
    expect(summary.byStatus.failed).toBe(0);
  });

  it('the real Study shape is PARTIAL and must never summarise as success', async () => {
    const r = await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
        action({ capability: 'ringer', value: 'silent' }),
      ]),
      {
        registry: {
          backend: 'mock',
          get(c) {
            return c === 'ringer' ? unavailable() : mockRegistry.get(c);
          },
          async openSettingsFor() {},
        },
        snapshots: createInMemorySnapshotStore(),
      },
    );

    expect(r.state).toBe('PARTIAL');
    expect(summarisePlan(r.results).byStatus.applied).toBe(2);
    expect(summarisePlan(r.results).total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Progress: pending and running exist, and are not outcomes
// ---------------------------------------------------------------------------

describe('progress states', () => {
  it('reports pending then running then settled for each action', async () => {
    const seen: string[] = [];

    await startContext(
      plan([
        action({ capability: 'dnd', value: 'priority' }),
        action({ capability: 'brightness', value: 40, requiredPermission: 'write_settings' }),
      ]),
      {
        registry: mockRegistry,
        snapshots: createInMemorySnapshotStore(),
        onProgress: (e) => seen.push(`${e.index}:${e.phase}`),
      },
    );

    expect(seen).toEqual([
      '0:pending',
      '0:running',
      '0:settled',
      '1:pending',
      '1:running',
      '1:settled',
    ]);
  });

  it('pending and running are NOT ActionStatus values — a row can never be stored as running', () => {
    expect(ACTION_STATUSES).not.toContain('pending' as never);
    expect(ACTION_STATUSES).not.toContain('running' as never);
  });

  it('a settled event carries the real outcome, not just "done"', async () => {
    const settled: string[] = [];

    await startContext(plan([action({ capability: 'ringer', value: 'silent' })]), {
      registry: registry({ ringer: unavailable() }),
      snapshots: createInMemorySnapshotStore(),
      onProgress: (e) => {
        if (e.phase === 'settled' && e.result) settled.push(e.result.status);
      },
    });

    expect(settled).toEqual(['not_supported']);
  });
});
