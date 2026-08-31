/**
 * OWNER: AAYUSH — task A-V8
 *
 * Integration of the emergency rule into the app, NOT the rule itself.
 *
 * "Same caller, 4+ calls, rolling 10 minutes" lives in CallLogAnalyzer.kt and is covered by its
 * JVM tests, which run against the real Android call log projection. These tests drive the
 * analyser seam with the payloads that analyzer actually produces, and assert the things only
 * the integration can get wrong: that a failed read is not reported as "no emergency", that a
 * detection changes nothing on the device, and that the verdict is never recomputed here.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type { ActionPlan, Capability, PlannedAction } from '../../types';
import {
  mockRegistry,
  __resetMockState,
  __getMockState,
  __getMockPolicy,
  __getMockSavedPolicy,
} from '../../native/MockDevice';
import {
  executePlan,
  createInMemorySnapshotStore,
  evaluateEmergency,
  describeEmergency,
  type EmergencyStatus,
} from '../index';

const SESSION = 'session-1';

/** Builds a payload in the exact shape CallLogAnalyzer.evaluate() returns. */
function analyzerPayload(
  callers: { id: string; name?: string | null; count: number }[],
  opts: { unidentified?: number } = {},
): Record<string, unknown> {
  const THRESHOLD = 4;
  const rows = callers.map((c) => ({
    id: c.id,
    name: c.name ?? null,
    count: c.count,
    qualifies: c.count >= THRESHOLD,
  }));

  return {
    ok: true,
    reason: null,
    thresholdMet: rows.some((r) => r.qualifies),
    qualifyingCallers: rows.filter((r) => r.qualifies).map((r) => r.id),
    callers: rows,
    unidentifiedCalls: opts.unidentified ?? 0,
    windowMinutes: 10,
    threshold: THRESHOLD,
    message: 'analyzer message',
  };
}

const check = (payload: Record<string, unknown> | null, sessionId: string | null = SESSION) =>
  evaluateEmergency({ analyse: () => payload, sessionId });

beforeEach(() => {
  __resetMockState();
});

// ---------------------------------------------------------------------------
// The rule, as reported through the seam
// ---------------------------------------------------------------------------

describe('threshold', () => {
  it('1 call is not an emergency', () => {
    const s = check(analyzerPayload([{ id: '+15551234567', count: 1 }]));
    expect(s.detected).toBe(false);
    expect(s.qualifyingCallers).toEqual([]);
  });

  it('3 calls is not an emergency — the threshold is 4, not "a few"', () => {
    const s = check(analyzerPayload([{ id: '+15551234567', count: 3 }]));
    expect(s.detected).toBe(false);
  });

  it('4 calls in the window IS an emergency', () => {
    const s = check(analyzerPayload([{ id: '+15551234567', name: 'Mom', count: 4 }]));
    expect(s.detected).toBe(true);
    expect(s.qualifyingCallers).toEqual(['+15551234567']);
    expect(s.threshold).toBe(4);
    expect(s.windowMinutes).toBe(10);
  });

  it('rolling expiry: calls that fell out of the window are simply not in the payload', () => {
    // The analyzer filters by timestamp before counting, so an expired call reduces the count
    // it reports. This asserts the integration honours that rather than caching a past verdict.
    const before = check(analyzerPayload([{ id: '+1', count: 4 }]));
    expect(before.detected).toBe(true);

    const after = check(analyzerPayload([{ id: '+1', count: 3 }]));
    expect(after.detected).toBe(false);
  });

  it('counts callers separately — three people calling twice each is not an emergency', () => {
    const s = check(
      analyzerPayload([
        { id: '+1', count: 2 },
        { id: '+2', count: 2 },
        { id: '+3', count: 2 },
      ]),
    );

    expect(s.detected).toBe(false);
    expect(s.callers).toHaveLength(3);
  });

  it('picks out only the caller that qualifies when several are calling', () => {
    const s = check(
      analyzerPayload([
        { id: '+1', name: 'Mom', count: 5 },
        { id: '+2', count: 2 },
      ]),
    );

    expect(s.qualifyingCallers).toEqual(['+1']);
    expect(s.callers.find((c) => c.id === '+2')?.qualifies).toBe(false);
  });

  it('never merges withheld numbers into one caller', () => {
    // Four calls from withheld numbers must NOT become "someone called four times".
    const s = check(analyzerPayload([], { unidentified: 4 }));

    expect(s.detected).toBe(false);
    expect(s.unidentifiedCalls).toBe(4);
    expect(s.callers).toEqual([]);
  });

  it('takes the verdict from the analyzer rather than recomputing it', () => {
    // A payload whose `qualifies` disagrees with `count >= 4`. The analyzer is the authority;
    // recomputing here would give the product two answers to the same question.
    const s = check({
      ...analyzerPayload([{ id: '+1', count: 9 }]),
      thresholdMet: false,
      qualifyingCallers: [],
      callers: [{ id: '+1', name: null, count: 9, qualifies: false }],
    });

    expect(s.detected).toBe(false);
    expect(s.callers[0]?.qualifies).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Failure is not "no emergency"
// ---------------------------------------------------------------------------

describe('unreadable call log', () => {
  it('a denied permission reports ok:false, NOT "no emergency"', () => {
    const s = check({
      ok: false,
      reason: 'permission',
      message: 'Ally needs permission to read your recent calls.',
    });

    expect(s.ok).toBe(false);
    expect(s.reason).toBe('permission');
    // The distinction that matters: we did not look, so we cannot say nobody called.
    expect(s.detected).toBe(false);
    expect(s.message).toContain('permission');
  });

  it('no native module reports unsupported', () => {
    const s = check(null);

    expect(s.ok).toBe(false);
    expect(s.reason).toBe('unsupported');
  });

  it('a throwing analyser is contained and reported, never propagated', () => {
    const s = evaluateEmergency({
      analyse: () => {
        throw new Error('call log query failed');
      },
      sessionId: SESSION,
    });

    expect(s.ok).toBe(false);
    expect(s.reason).toBe('error');
    expect(s.message).toBe('call log query failed');
  });

  it('a malformed payload degrades safely instead of inventing callers', () => {
    const s = check({ ok: true, thresholdMet: false, callers: 'not-an-array' });

    expect(s.ok).toBe(true);
    expect(s.callers).toEqual([]);
    expect(s.detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contextual, and inert
// ---------------------------------------------------------------------------

describe('emergency is contextual and changes nothing', () => {
  it('carries the session it was evaluated for', () => {
    expect(check(analyzerPayload([{ id: '+1', count: 4 }]), 'sess_abc').sessionId).toBe('sess_abc');
  });

  it('works with no session at all — a reading is not owned by a context', () => {
    expect(check(analyzerPayload([{ id: '+1', count: 4 }]), null).sessionId).toBeNull();
  });

  it('does NOT add the qualifying caller to Priority', async () => {
    const before = __getMockPolicy();

    const s = check(analyzerPayload([{ id: '+1', name: 'Mom', count: 6 }]));
    expect(s.detected).toBe(true);

    // A detection is an observation, not a durable preference the user never made.
    expect(__getMockPolicy()).toEqual(before);
    expect(__getMockSavedPolicy()).toBeNull();
  });

  it('does NOT touch the device snapshot restore depends on', async () => {
    const snapshots = createInMemorySnapshotStore();
    const plan: ActionPlan = {
      sessionId: SESSION,
      restoreOnEnd: true,
      actions: [
        {
          capability: 'dnd' as Capability,
          value: 'priority',
          needsSnapshot: true,
          requiredPermission: 'notification_policy',
          reason: 'test',
        } as PlannedAction,
      ],
    };

    await executePlan(plan, { registry: mockRegistry, snapshots });
    const before = await snapshots.forSession(SESSION);

    check(analyzerPayload([{ id: '+1', count: 5 }]));

    expect(await snapshots.forSession(SESSION)).toEqual(before);
    expect(__getMockState().dnd).toBe('priority'); // context untouched by the reading
  });

  it('a detection during a context does not end or alter the context', async () => {
    const snapshots = createInMemorySnapshotStore();
    await executePlan(
      {
        sessionId: SESSION,
        restoreOnEnd: true,
        actions: [
          {
            capability: 'dnd' as Capability,
            value: 'priority',
            needsSnapshot: true,
            requiredPermission: 'notification_policy',
            reason: 'test',
          } as PlannedAction,
        ],
      },
      { registry: mockRegistry, snapshots },
    );

    check(analyzerPayload([{ id: '+1', count: 4 }]));

    expect(__getMockState().dnd).toBe('priority');
    expect(await snapshots.forSession(SESSION)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// What we tell the user
// ---------------------------------------------------------------------------

describe('describeEmergency', () => {
  it('says Ally observed it and Android decides — never that Ally made it ring', () => {
    const s: EmergencyStatus = check(
      analyzerPayload([{ id: '+15551234567', name: 'Mom', count: 4 }]),
    );
    const text = describeEmergency(s);

    expect(text).toContain('Mom');
    expect(text).toContain('Android decides');
    expect(text.toLowerCase()).not.toContain('we made');
  });

  it('falls back to the caller id when the contact has no name', () => {
    expect(describeEmergency(check(analyzerPayload([{ id: '+15550001', count: 4 }])))).toContain(
      '+15550001',
    );
  });

  it('passes the failure message through when the log could not be read', () => {
    const s = check({ ok: false, reason: 'permission', message: 'Permission needed.' });
    expect(describeEmergency(s)).toBe('Permission needed.');
  });
});
