/**
 * OWNER: AAYUSH — Phase 5 (A5.1, A5.3, A5.4, A5.5, A5.6, A5.7)
 *
 * The wake-up alarm, from a real Sleep sentence to the Clock app and back.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE. On a real phone Ally cannot read the Clock's alarms —
 * `AlarmClock` exposes SET, DISMISS and SHOW and nothing else. The mock deliberately gives these
 * tests a view the product does not have, so that "the user's own alarm was left alone" and "a
 * weekday alarm is not a one-shot" are assertable at all. That view is scaffolding: the ACCEPTANCE
 * evidence is opening the stock Clock on the SM-S928B, recorded in docs/DEVICE_NOTES.md. What is
 * genuinely proved here is the logic around the intent — recurrence never invented, idempotency,
 * refusals told apart from absence, and the alarm staying out of the restore path.
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

import { ensureSeeded } from '../../memory';
import { getDatabase } from '../../memory/database';
import { activateFromText } from '../../services/contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import type { ActionPlan, Capability, ParseResult, PlannedAction } from '../../types';
import type { ActivationOutcome } from '../../services/contextOrchestrator';
import {
  mockRegistry,
  withMockAlarmContext,
  dismissMockAlarm,
  __resetMockState,
  __setMockPermission,
  __setMockBrightnessRaw,
  __getMockBrightnessRaw,
  __getMockAlarms,
  __getMockState,
  __setMockClockAvailable,
  __setMockClockRefuses,
  __simulateProcessDeath,
} from '../../native/MockDevice';
import { startContext, endContext, createInMemorySnapshotStore, summarisePlan } from '../index';

const SESSION = 'sess_alarm';
const USER_RAW = 187;

/** The alarm that was in the Clock before Ally existed. Nothing Ally does may touch it. */
const USER_ALARM = { time: '06:00', weekdays: true, label: 'Work' };

const offlineEngine = {
  async parse(text: string): Promise<ParseResult> {
    return IntentValidator.validate((await new FallbackParser().parse(text)) as ParseResult);
  },
};

function action(overrides: Partial<PlannedAction> & { capability: Capability }): PlannedAction {
  return {
    value: '07:00',
    needsSnapshot: false,
    requiredPermission: 'exact_alarm',
    reason: 'from your command',
    ...overrides,
  };
}

const alarmPlan = (value: string, sessionId = SESSION): ActionPlan => ({
  sessionId,
  restoreOnEnd: true,
  actions: [action({ capability: 'alarm', value })],
});

/** The registry the app shell composes: one entry swapped, everything else delegated. */
const withAlarm = (recurrence: 'once' | 'weekdays', sessionId = SESSION) =>
  withMockAlarmContext(mockRegistry, { recurrence, sessionId });

const run = (plan: ActionPlan, recurrence: 'once' | 'weekdays' = 'once') =>
  startContext(plan, {
    registry: withAlarm(recurrence, plan.sessionId),
    snapshots: createInMemorySnapshotStore(),
  });

/** Only the alarms Ally created. The user's own are filtered out by label, as dismissal is. */
const allyAlarms = () => __getMockAlarms().filter((a) => a.label === 'Ally wake-up');
const userAlarms = () => __getMockAlarms().filter((a) => a.label !== 'Ally wake-up');

beforeAll(async () => {
  await getDatabase();
  await ensureSeeded();
});

beforeEach(() => {
  __resetMockState();
});

// ---------------------------------------------------------------------------
// A5.1 — creating the alarm
// ---------------------------------------------------------------------------

describe('A5.1 — the alarm reaches the Clock app', () => {
  it('a one-shot alarm is created at the requested time', async () => {
    const r = await run(alarmPlan('07:00'));

    expect(r.results[0]?.status).toBe('applied');
    expect(allyAlarms()).toEqual([{ time: '07:00', weekdays: false, label: 'Ally wake-up' }]);
  });

  it('says SENT, never that the alarm is set — there is no read-back to justify the stronger claim', async () => {
    const r = await run(alarmPlan('07:00'));
    const message = r.results[0]?.message ?? '';

    expect(message).toMatch(/sent to your clock app/i);
    // "we handed it over" and "it is definitely there" are different promises, and only the
    // first one is checkable on a real device.
    expect(message).not.toMatch(/alarm is set|will ring|wake you/i);
  });

  it('a weekday alarm is recurring, and a plain one is not', async () => {
    await run(alarmPlan('07:00'), 'weekdays');
    expect(allyAlarms()[0]?.weekdays).toBe(true);

    __resetMockState();
    await run(alarmPlan('07:00'), 'once');
    expect(allyAlarms()[0]?.weekdays).toBe(false);
  });

  it('never invents recurrence — no context at all means one-shot', async () => {
    // The default registry, with nothing bound. A missing schedule must not become a daily alarm.
    await startContext(alarmPlan('07:00'), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    expect(allyAlarms()[0]?.weekdays).toBe(false);
  });

  it("leaves the user's own alarm completely alone", async () => {
    await run(alarmPlan('07:00'), 'weekdays');
    expect(userAlarms()).toEqual([USER_ALARM]);
  });
});

// ---------------------------------------------------------------------------
// A5.1 — idempotency
// ---------------------------------------------------------------------------

describe('A5.1 — the same alarm asked for twice is sent once', () => {
  it('the second identical action reports skipped and adds nothing to the Clock', async () => {
    const plan: ActionPlan = {
      sessionId: SESSION,
      restoreOnEnd: true,
      // Exactly the shape Dhrey's planner produces for a Sleep command today.
      actions: [action({ capability: 'alarm' }), action({ capability: 'alarm' })],
    };

    const r = await run(plan);

    expect(r.results.map((x) => x.status)).toEqual(['applied', 'skipped']);
    expect(allyAlarms()).toHaveLength(1);
  });

  it('a skipped duplicate does NOT drag the context to PARTIAL', async () => {
    const plan: ActionPlan = {
      sessionId: SESSION,
      restoreOnEnd: true,
      actions: [action({ capability: 'alarm' }), action({ capability: 'alarm' })],
    };

    const r = await run(plan);

    // Nothing went wrong, so nothing may say it did. `skipped` means the requested state is
    // already true, which is settled — the same rule summariseRestore has always used.
    expect(r.state).toBe('ACTIVE');
    expect(summarisePlan(r.results).byStatus.skipped).toBe(1);
  });

  it('a DIFFERENT time in the same session is a new alarm, not a duplicate', async () => {
    await run(alarmPlan('07:00'));
    const r = await run(alarmPlan('07:30'));

    expect(r.results[0]?.status).toBe('applied');
    expect(allyAlarms().map((a) => a.time)).toEqual(['07:00', '07:30']);
  });

  it('the same time with a different recurrence is also a new alarm', async () => {
    await run(alarmPlan('07:00'), 'once');
    const r = await run(alarmPlan('07:00'), 'weekdays');

    expect(r.results[0]?.status).toBe('applied');
    expect(allyAlarms().map((a) => a.weekdays)).toEqual([false, true]);
  });

  it('idempotency survives a process death, because the record is not in the heap', async () => {
    await run(alarmPlan('07:00'));
    __simulateProcessDeath();

    const r = await run(alarmPlan('07:00'));

    expect(r.results[0]?.status).toBe('skipped');
    expect(allyAlarms()).toHaveLength(1);
  });

  it('a different session is a different scope', async () => {
    await run(alarmPlan('07:00', 'sess_a'));
    const r = await run(alarmPlan('07:00', 'sess_b'));

    expect(r.results[0]?.status).toBe('applied');
  });
});

// ---------------------------------------------------------------------------
// A5.1 — the ways it can fail, told apart
// ---------------------------------------------------------------------------

describe('A5.1 — refusals are distinguishable', () => {
  it('an invalid time is failed, and nothing is sent', async () => {
    const r = await run(alarmPlan('25:99'));

    expect(r.results[0]?.status).toBe('failed');
    expect(allyAlarms()).toHaveLength(0);
  });

  it('no Clock app is not_supported — not a failure', async () => {
    __setMockClockAvailable(false);
    const r = await run(alarmPlan('07:00'));

    expect(r.results[0]?.status).toBe('not_supported');
    expect(r.results[0]?.status).not.toBe('failed');
  });

  it('a missing permission is permission_needed, with nothing attempted', async () => {
    __setMockPermission('exact_alarm', false);
    const r = await run(alarmPlan('07:00'));

    expect(r.results[0]?.status).toBe('permission_needed');
    expect(allyAlarms()).toHaveLength(0);
  });

  it('a Clock that is present and refuses is failed — a different answer from absent', async () => {
    __setMockClockRefuses(true);
    const r = await run(alarmPlan('07:00'));

    expect(r.results[0]?.status).toBe('failed');
    expect(r.results[0]?.status).not.toBe('not_supported');
    expect(allyAlarms()).toHaveLength(0);
  });

  it('a refusal leaves nothing remembered, so retrying actually retries', async () => {
    __setMockClockRefuses(true);
    await run(alarmPlan('07:00'));

    __setMockClockRefuses(false);
    const retry = await run(alarmPlan('07:00'));

    expect(retry.results[0]?.status).toBe('applied');
    expect(allyAlarms()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A5.4 / A5.5 — modification and cancellation
// ---------------------------------------------------------------------------

describe('A5.4 — changing 07:00 to 07:30', () => {
  it('dismiss-then-set leaves one alarm at the new time and no 07:00 behind', async () => {
    await run(alarmPlan('07:00'));
    expect(allyAlarms().map((a) => a.time)).toEqual(['07:00']);

    // The only sequence the platform offers: there is no "edit alarm" intent.
    expect(dismissMockAlarm(SESSION).ok).toBe(true);
    const r = await run(alarmPlan('07:30'));

    expect(r.results[0]?.status).toBe('applied');
    expect(allyAlarms().map((a) => a.time)).toEqual(['07:30']);
    expect(userAlarms()).toEqual([USER_ALARM]);
  });
});

describe('A5.5 — native dismissal', () => {
  it("removes Ally's alarm and only Ally's", async () => {
    await run(alarmPlan('07:00'));
    expect(__getMockAlarms()).toHaveLength(2);

    const out = dismissMockAlarm(SESSION);

    expect(out.ok).toBe(true);
    expect(allyAlarms()).toHaveLength(0);
    expect(userAlarms()).toEqual([USER_ALARM]);
  });

  it('clears the idempotency record, so the next request is sent rather than skipped', async () => {
    await run(alarmPlan('07:00'));
    dismissMockAlarm(SESSION);

    const again = await run(alarmPlan('07:00'));
    expect(again.results[0]?.status).toBe('applied');
  });

  it('reports a missing permission and a missing Clock apart, without touching anything', async () => {
    await run(alarmPlan('07:00'));

    __setMockPermission('exact_alarm', false);
    expect(dismissMockAlarm(SESSION).reason).toBe('permission');

    __setMockPermission('exact_alarm', true);
    __setMockClockAvailable(false);
    expect(dismissMockAlarm(SESSION).reason).toBe('unsupported');

    __setMockClockAvailable(true);
    expect(allyAlarms()).toHaveLength(1); // neither refusal removed it
  });

  it('BLOCKED UPSTREAM: no ActionPlan can express cancellation today', async () => {
    // Executable record of the integration gap, so it cannot be quietly forgotten. Shlok's parser
    // reads the sentence correctly — operation `modify`, schedule kind `none` — and Dhrey's
    // planner then has nothing to emit for it, because an ActionPlan can only ask for a value.
    const outcome = await activateFromText('Cancel the wake-up alarm.', { engine: offlineEngine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    expect(outcome.intent.operation).toBe('modify');
    expect(outcome.intent.schedule).toEqual({ kind: 'none', time: null });
    // The gap: nothing in the plan reaches the alarm capability.
    expect(outcome.plan.actions.some((a) => a.capability === 'alarm')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A5.3 / A5.7 — Sleep through the real pipeline
// ---------------------------------------------------------------------------

describe('A5.3 — Sleep, from the sentence', () => {
  async function sleep(
    sentence: string,
  ): Promise<Extract<ActivationOutcome, { kind: 'activated' }>> {
    const outcome = await activateFromText(sentence, { engine: offlineEngine });
    if (outcome.kind !== 'activated') throw new Error('expected an activation');
    return outcome;
  }

  it('"I\'m going to sleep. Wake me at 7 AM on weekdays." dims, silences and sets one alarm', async () => {
    __setMockBrightnessRaw(USER_RAW);
    const outcome = await sleep("I'm going to sleep. Wake me at 7 AM on weekdays.");

    expect(outcome.intent.schedule).toEqual({ kind: 'weekdays', time: '07:00' });

    const snapshots = createInMemorySnapshotStore();
    const r = await startContext(outcome.plan, {
      // The shell binds the recurrence the user actually said. It cannot travel in the plan.
      registry: withMockAlarmContext(mockRegistry, {
        recurrence: outcome.intent.schedule!.kind === 'weekdays' ? 'weekdays' : 'once',
        sessionId: outcome.plan.sessionId,
      }),
      snapshots,
    });

    expect(__getMockState().dnd).toBe('alarms_only');
    expect(__getMockState().brightnessRaw).toBe(26); // 10% of 255
    expect(allyAlarms()).toEqual([{ time: '07:00', weekdays: true, label: 'Ally wake-up' }]);
    // Four actions, two of them the same alarm — and still nothing went wrong.
    expect(r.state).toBe('ACTIVE');
  });

  it('the alarm is never snapshotted, so it cannot be restored away', async () => {
    __setMockBrightnessRaw(USER_RAW);
    const outcome = await sleep('Wake me at 7 AM.');
    const snapshots = createInMemorySnapshotStore();

    await startContext(outcome.plan, {
      registry: withMockAlarmContext(mockRegistry, {
        recurrence: 'once',
        sessionId: outcome.plan.sessionId,
      }),
      snapshots,
    });

    const captured = (await snapshots.forSession(outcome.plan.sessionId)).map((s) => s.capability);
    expect(captured).not.toContain('alarm');
    expect(captured.sort()).toEqual(['brightness', 'dnd']);
  });

  it('A5.7: ending Sleep restores the device exactly and LEAVES the alarm alone', async () => {
    __setMockBrightnessRaw(USER_RAW);
    const outcome = await sleep("I'm going to sleep. Wake me at 7 AM on weekdays.");
    const snapshots = createInMemorySnapshotStore();
    const registry = withMockAlarmContext(mockRegistry, {
      recurrence: 'weekdays',
      sessionId: outcome.plan.sessionId,
    });

    await startContext(outcome.plan, { registry, snapshots });
    const end = await endContext(outcome.plan.sessionId, { registry, snapshots });

    expect(end.state).toBe('IDLE');
    expect(__getMockBrightnessRaw()).toBe(USER_RAW);
    expect(__getMockState().dnd).toBe('off');
    // The point: waking up must not delete tomorrow's alarm.
    expect(allyAlarms()).toHaveLength(1);
    expect(userAlarms()).toEqual([USER_ALARM]);
  });

  it('A5.7: the same holds across a process death', async () => {
    __setMockBrightnessRaw(USER_RAW);
    const outcome = await sleep('Wake me at 7 AM.');
    const snapshots = createInMemorySnapshotStore();
    const registry = withMockAlarmContext(mockRegistry, {
      recurrence: 'once',
      sessionId: outcome.plan.sessionId,
    });

    await startContext(outcome.plan, { registry, snapshots });
    __simulateProcessDeath();

    const end = await endContext(outcome.plan.sessionId, { registry, snapshots });

    expect(end.state).toBe('IDLE');
    expect(__getMockBrightnessRaw()).toBe(USER_RAW);
    expect(allyAlarms()).toHaveLength(1);
  });

  it('a sleep command with no time creates no alarm at all', async () => {
    const outcome = await sleep("I'm going to sleep.");
    expect(outcome.intent.schedule).toBeNull();

    await startContext(outcome.plan, {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    // No fake alarm invented to fill the gap.
    expect(allyAlarms()).toHaveLength(0);
  });
});
