/**
 * OWNER: DHREY — task D3.3 (Undo / Reversal)
 *
 * Real repositories, real SQLite (better-sqlite3 in-memory via setupTests.ts), real
 * D3.1 snapshots and real D3.2 history. No snapshot is fabricated in JavaScript and no
 * repository is mocked — every original below survived an actual INSERT and SELECT.
 *
 * No Android API is touched: D3.3 ends at the ActionPlan.
 */

import { getDatabase } from '../../memory/database';
import {
  endSession,
  ensureSeeded,
  findReversibleContext,
  findRestorationTarget,
  getRestorationTarget,
  listRestoreHistory,
  snapshotRepository,
  startSession,
} from '../../memory';
import { buildRestorePlan } from '../../policy';
import { planReversal, planReversalForSession } from '../reversalService';
import { CAPABILITIES } from '../../types';
import type { DeviceSnapshot } from '../../types';

const STUDY = 'profile_study';
const SLEEP = 'profile_sleep';

/** A NotificationManager.Policy as the native layer reports it, JSON-encoded. */
const POLICY_BLOB = JSON.stringify({
  priorityCategories: ['ALARMS', 'MEDIA'],
  priorityCallSenders: 'STARRED',
});

function snap(sessionId: string, over: Partial<DeviceSnapshot> = {}): DeviceSnapshot {
  return {
    id: `snap_${Math.random().toString(36).slice(2, 10)}`,
    sessionId,
    capability: 'brightness',
    previousValue: 82,
    capturedAt: 1_700_000_000_000,
    ...over,
  };
}

/** A finished context with its originals already captured. */
async function completedContext(
  profileId: string,
  startedAt: number,
  endedAt: number,
  snapshots: Partial<DeviceSnapshot>[],
) {
  const session = await startSession({ profileId, now: startedAt, durationMinutes: null });
  for (const s of snapshots) {
    await snapshotRepository.create(snap(session.id, s));
  }
  await endSession(session.id, { now: endedAt });
  return session;
}

async function clearProfile(profileId: string) {
  const db = await getDatabase();
  for (const entry of await listRestoreHistory(profileId)) {
    await snapshotRepository.cleanupSessionSnapshots(entry.session.id);
    await db.runAsync('DELETE FROM context_session WHERE id = ?', [entry.session.id]);
  }
}

const NOW = 100_000;

describe('D3.3 undo / reversal', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(async () => {
    await clearProfile(STUDY);
    await clearProfile(SLEEP);
  });

  // ── TEST 1 — undo selects the latest eligible context ──────────────────────
  it('D33-1: the most recently finished context is the one undone', async () => {
    await completedContext(STUDY, 1000, 2000, [{ capability: 'brightness', previousValue: 82 }]);
    const b = await completedContext(STUDY, 3000, 4000, [
      { capability: 'brightness', previousValue: 70 },
    ]);

    const chosen = await findReversibleContext(STUDY, NOW);

    expect(chosen!.session.id).toBe(b.id);
    const target = await findRestorationTarget(STUDY, NOW);
    expect(target!.restorable[0]!.previousValue).toBe(70);
  });

  it('D33-1b: selection is by END time, so the context just exited wins', async () => {
    // A starts first but runs long; B starts later and finishes first.
    const a = await completedContext(STUDY, 1000, 9000, [
      { capability: 'brightness', previousValue: 82 },
    ]);
    await completedContext(STUDY, 2000, 3000, [{ capability: 'brightness', previousValue: 70 }]);

    const chosen = await findReversibleContext(STUDY, NOW);

    // A finished last, so A is what "undo that" means.
    expect(chosen!.session.id).toBe(a.id);
    expect(chosen!.session.endsAt).toBe(9000);
  });

  it('D33-1c: selection is deterministic across repeated calls', async () => {
    await completedContext(STUDY, 1000, 2000, [{ capability: 'brightness', previousValue: 82 }]);
    await completedContext(STUDY, 3000, 4000, [{ capability: 'dnd', previousValue: 'priority' }]);

    const runs = [];
    for (let i = 0; i < 5; i++) {
      runs.push((await findReversibleContext(STUDY, NOW))!.session.id);
    }
    expect(new Set(runs).size).toBe(1);
  });

  // ── TEST 2 — the target is the ORIGINAL, never the changed value ───────────
  it('D33-2: undo targets the original 82, not the 40 the context set', async () => {
    await completedContext(STUDY, 1000, 2000, [{ capability: 'brightness', previousValue: 82 }]);

    const reversal = await planReversal(STUDY, NOW);
    const action = reversal!.plan.actions.find((a) => a.capability === 'brightness');

    expect(action!.value).toBe(82);
    expect(action!.value).not.toBe(40);
  });

  // ── TEST 3 — multiple capabilities ─────────────────────────────────────────
  it('D33-3: every original in the context appears in the restoration target', async () => {
    await completedContext(STUDY, 1000, 2000, [
      { capability: 'brightness', previousValue: 82, capturedAt: 1 },
      { capability: 'dnd', previousValue: 'priority', capturedAt: 2 },
    ]);

    const reversal = await planReversal(STUDY, NOW);
    const byCapability = Object.fromEntries(
      reversal!.plan.actions.map((a) => [a.capability, a.value]),
    );

    expect(byCapability.brightness).toBe(82);
    expect(byCapability.dnd).toBe('priority');
    expect(reversal!.plan.actions).toHaveLength(2);
  });

  // ── TEST 4 — contexts stay isolated ────────────────────────────────────────
  it('D33-4: undoing one context leaves the other untouched', async () => {
    const a = await completedContext(STUDY, 1000, 2000, [
      { capability: 'brightness', previousValue: 82 },
    ]);
    const b = await completedContext(SLEEP, 3000, 4000, [
      { capability: 'brightness', previousValue: 15 },
    ]);

    const reversalB = await planReversalForSession(b.id);
    expect(reversalB!.plan.actions[0]!.value).toBe(15);
    expect(reversalB!.plan.sessionId).toBe(b.id);

    // A is unchanged and still independently reversible.
    const targetA = await getRestorationTarget(a.id);
    expect(targetA!.restorable).toHaveLength(1);
    expect(targetA!.restorable[0]!.previousValue).toBe(82);
    expect(targetA!.session.id).toBe(a.id);
  });

  // ── TEST 5 — nothing to undo ───────────────────────────────────────────────
  it('D33-5: with no eligible history, undo returns explicit absence', async () => {
    expect(await findReversibleContext(STUDY, NOW)).toBeNull();
    expect(await findRestorationTarget(STUDY, NOW)).toBeNull();
    expect(await planReversal(STUDY, NOW)).toBeNull();
  });

  it('D33-5b: a still-running context is not undoable', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await snapshotRepository.create(snap(session.id, { previousValue: 82 }));

    // It has originals, but it has not finished — there is nothing to undo yet.
    expect(await planReversal(STUDY, NOW)).toBeNull();

    await endSession(session.id, { now: 2000 });
    expect(await planReversal(STUDY, NOW)).not.toBeNull();
  });

  it('D33-5c: an unknown session id yields null, not an empty plan', async () => {
    expect(await getRestorationTarget('sess_nope')).toBeNull();
    expect(await planReversalForSession('sess_nope')).toBeNull();
  });

  // ── TEST 6 — a context with no snapshots invents nothing ───────────────────
  it('D33-6: a finished context that captured nothing produces no restoration', async () => {
    await completedContext(STUDY, 1000, 2000, []);

    // Not a candidate at all — there is nothing stored to put back.
    expect(await findReversibleContext(STUDY, NOW)).toBeNull();
    expect(await planReversal(STUDY, NOW)).toBeNull();
  });

  it('D33-6b: an unreadable original is reported, never defaulted', async () => {
    const session = await completedContext(STUDY, 1000, 2000, [
      { capability: 'brightness', previousValue: 82 },
      { capability: 'ringer', previousValue: null },
    ]);

    const reversal = await planReversalForSession(session.id);

    // brightness is restorable; ringer is not, and is absent from the plan.
    expect(reversal!.plan.actions).toHaveLength(1);
    expect(reversal!.plan.actions[0]!.capability).toBe('brightness');
    expect(reversal!.target.unavailable).toHaveLength(1);
    expect(reversal!.target.unavailable[0]!.capability).toBe('ringer');
    // No fabricated 0 / 'off' / 'normal' anywhere in the plan.
    for (const action of reversal!.plan.actions) {
      expect(action.value).not.toBeNull();
      expect(action.capability).not.toBe('ringer');
    }
  });

  // ── TEST 7 — first-write-wins survives into the undo target ────────────────
  it('D33-7: undo uses the first captured value even after a later re-capture', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });

    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82, capturedAt: 1000 }),
    );
    // A careless re-capture taken after the context already dimmed the screen.
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 40, capturedAt: 2000 }),
    );
    await endSession(session.id, { now: 3000 });

    const reversal = await planReversal(STUDY, NOW);

    expect(reversal!.plan.actions).toHaveLength(1);
    expect(reversal!.plan.actions[0]!.value).toBe(82);
    expect(reversal!.plan.actions[0]!.value).not.toBe(40);
  });

  // ── TEST 8 — DND ───────────────────────────────────────────────────────────
  it('D33-8: the original DND interruption filter is the restoration target', async () => {
    await completedContext(STUDY, 1000, 2000, [{ capability: 'dnd', previousValue: 'priority' }]);

    const reversal = await planReversal(STUDY, NOW);
    const dnd = reversal!.plan.actions.find((a) => a.capability === 'dnd');

    expect(dnd!.value).toBe('priority');
    expect(dnd!.requiredPermission).toBe('notification_policy');
  });

  // ── TEST 9 — NotificationManager.Policy ────────────────────────────────────
  it('D33-9: a policy blob is returned unchanged as the restoration target', async () => {
    await completedContext(STUDY, 1000, 2000, [{ capability: 'dnd', previousValue: POLICY_BLOB }]);

    const reversal = await planReversal(STUDY, NOW);
    const dnd = reversal!.plan.actions.find((a) => a.capability === 'dnd');

    expect(dnd!.value).toBe(POLICY_BLOB);
    const reparsed = JSON.parse(dnd!.value as string);
    expect(reparsed.priorityCategories).toEqual(['ALARMS', 'MEDIA']);
    expect(reparsed.priorityCallSenders).toBe('STARRED');
  });

  // ── TEST 10 — cross-session protection ─────────────────────────────────────
  it('D33-10: a restoration target never mixes another session’s originals', async () => {
    const a = await completedContext(STUDY, 1000, 2000, [
      { capability: 'brightness', previousValue: 82 },
      { capability: 'dnd', previousValue: 'priority' },
    ]);
    const b = await completedContext(SLEEP, 3000, 4000, [
      { capability: 'brightness', previousValue: 15 },
    ]);

    const targetA = await getRestorationTarget(a.id);
    const targetB = await getRestorationTarget(b.id);

    for (const s of targetA!.restorable) expect(s.sessionId).toBe(a.id);
    for (const s of targetB!.restorable) expect(s.sessionId).toBe(b.id);

    expect(targetA!.restorable).toHaveLength(2);
    expect(targetB!.restorable).toHaveLength(1);
    expect(targetB!.restorable.map((s) => s.previousValue)).not.toContain(82);

    // The plan is stamped with the session it restores.
    const planA = buildRestorePlan(a.id, targetA!.restorable);
    expect(planA.sessionId).toBe(a.id);
    expect(planA.actions).toHaveLength(2);
  });

  // ── TEST 11 — lookup mutates nothing ───────────────────────────────────────
  it('D33-11: repeated reversal lookups create and change nothing', async () => {
    const session = await completedContext(STUDY, 1000, 2000, [
      { capability: 'brightness', previousValue: 82 },
      { capability: 'dnd', previousValue: 'priority' },
    ]);

    const first = await planReversal(STUDY, NOW);

    for (let i = 0; i < 5; i++) {
      await planReversal(STUDY, NOW);
      await findReversibleContext(STUDY, NOW);
      await getRestorationTarget(session.id);
    }

    const after = await planReversal(STUDY, NOW);
    expect(after).toEqual(first);

    const db = await getDatabase();
    const snaps = await db.getAllAsync<{ id: string; previousValue: string }>(
      'SELECT id, previousValue FROM device_snapshot WHERE sessionId = ? ORDER BY capturedAt',
      [session.id],
    );
    expect(snaps).toHaveLength(2);
    expect(snaps[0]!.previousValue).toBe('82');

    const sessions = await db.getAllAsync('SELECT id FROM context_session WHERE id = ?', [
      session.id,
    ]);
    expect(sessions).toHaveLength(1);
  });

  // ── TEST 12 — an already-restored context is not chosen again ──────────────
  it('D33-12: after a restore clears its snapshots, undo moves to the previous context', async () => {
    const older = await completedContext(STUDY, 1000, 2000, [
      { capability: 'brightness', previousValue: 82 },
    ]);
    const latest = await completedContext(STUDY, 3000, 4000, [
      { capability: 'brightness', previousValue: 70 },
    ]);

    expect((await findReversibleContext(STUDY, NOW))!.session.id).toBe(latest.id);

    // A verified restore ends by clearing the snapshots it consumed (FLOW.md §6).
    await snapshotRepository.cleanupSessionSnapshots(latest.id);

    // A second "undo that" must not replay the context already put back.
    const next = await findReversibleContext(STUDY, NOW);
    expect(next!.session.id).toBe(older.id);
    expect(next!.session.id).not.toBe(latest.id);

    const reversal = await planReversal(STUDY, NOW);
    expect(reversal!.plan.actions[0]!.value).toBe(82);
  });

  // ── Plan shape: the frozen contract, used correctly ────────────────────────
  it('D33-13: the restore plan conforms to the existing ActionPlan contract', async () => {
    const session = await completedContext(STUDY, 1000, 2000, [
      { capability: 'brightness', previousValue: 82 },
      { capability: 'dnd', previousValue: 'priority' },
    ]);

    const reversal = await planReversalForSession(session.id);
    const { plan } = reversal!;

    expect(typeof plan.sessionId).toBe('string');
    expect(Array.isArray(plan.actions)).toBe(true);

    for (const action of plan.actions) {
      expect(CAPABILITIES as readonly string[]).toContain(action.capability);
      expect(action.value).toBeDefined();
      expect(typeof action.reason).toBe('string');
      expect(action.reason.length).toBeGreaterThan(0);
      // Snapshotting mid-restore would overwrite the originals being restored.
      expect(action.needsSnapshot).toBe(false);
    }

    // Putting settings back is not itself a context to undo later.
    expect(plan.restoreOnEnd).toBe(false);
  });
});
