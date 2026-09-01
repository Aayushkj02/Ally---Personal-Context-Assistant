/**
 * OWNER: DHREY — task D3.2 (Restore History)
 *
 * Real repositories, real SQLite (better-sqlite3 in-memory via setupTests.ts). Nothing
 * that D3.2 assembles is mocked — every assertion is the result of actual INSERTs and
 * SELECTs through the same code a device would run.
 */

import { getDatabase } from '../database';
import {
  endSession,
  ensureSeeded,
  getOriginalValue,
  getRestoreHistory,
  listCompletedContexts,
  listRestorableContexts,
  listRestoreHistory,
  markSessionActive,
  snapshotRepository,
  startSession,
} from '../index';
import type { ContextSession, DeviceSnapshot } from '../../types';

const STUDY = 'profile_study';
const SLEEP = 'profile_sleep';

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

/** Remove every session this file created, so counts stay predictable. */
async function clearProfileHistory(profileId: string) {
  const db = await getDatabase();
  for (const entry of await listRestoreHistory(profileId)) {
    await snapshotRepository.cleanupSessionSnapshots(entry.session.id);
    await db.runAsync('DELETE FROM context_session WHERE id = ?', [entry.session.id]);
  }
}

describe('D3.2 restore history', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(async () => {
    await clearProfileHistory(STUDY);
    await clearProfileHistory(SLEEP);
  });

  // ── TEST 1 — a completed context stays retrievable ─────────────────────────
  it('D32-1: a context that started and ended remains retrievable as history', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await markSessionActive(session.id);
    await endSession(session.id, { now: 5000 });

    const history = await getRestoreHistory(session.id);

    expect(history).not.toBeNull();
    expect(history!.session.id).toBe(session.id);
    expect(history!.ended).toBe(true);
    // The mode/context name comes from the profile the session belonged to.
    expect(history!.profile).not.toBeNull();
    expect(history!.profile!.name).toBe('Study');
    expect(history!.profile!.modeKey).toBe('study');
  });

  it('D32-1b: an unknown session returns null, not an empty shell', async () => {
    expect(await getRestoreHistory('sess_does_not_exist')).toBeNull();
  });

  // ── TEST 2 — timestamps ────────────────────────────────────────────────────
  it('D32-2: start and end times are preserved and logically ordered', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await endSession(session.id, { now: 61_000 });

    const history = await getRestoreHistory(session.id);

    expect(history!.session.startedAt).toBe(1000);
    expect(history!.session.endsAt).toBe(61_000);
    expect(history!.session.endsAt!).toBeGreaterThan(history!.session.startedAt);
    expect(history!.durationMs).toBe(60_000);
  });

  it('D32-2b: a running context reports no duration rather than a fabricated one', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });

    const history = await getRestoreHistory(session.id);
    expect(history!.ended).toBe(false);
    expect(history!.durationMs).toBeNull();
  });

  // ── TEST 3 — snapshot association ──────────────────────────────────────────
  it('D32-3: every snapshot captured is associated with its context', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82 }),
    );
    await snapshotRepository.create(snap(session.id, { capability: 'dnd', previousValue: 'off' }));
    await snapshotRepository.create(
      snap(session.id, { capability: 'ringer', previousValue: 'normal' }),
    );
    await endSession(session.id);

    const history = await getRestoreHistory(session.id);

    expect(history!.snapshots).toHaveLength(3);
    for (const s of history!.snapshots) {
      expect(s.sessionId).toBe(session.id);
    }
  });

  // ── TEST 4 — original values, not later ones ───────────────────────────────
  it('D32-4: history reports the ORIGINAL value, not what the device became', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });

    // Captured before the context dimmed the screen.
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82 }),
    );
    // The context then set brightness to 40 — a device change, never a snapshot rewrite.
    await endSession(session.id);

    const history = await getRestoreHistory(session.id);
    const brightness = history!.snapshots.find((s) => s.capability === 'brightness');

    expect(brightness!.previousValue).toBe(82);
    expect(brightness!.previousValue).not.toBe(40);
  });

  it('D32-4b: a single original value can be read directly', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    await snapshotRepository.create(snap(session.id, { capability: 'dnd', previousValue: 'off' }));

    const dnd = await getOriginalValue(session.id, 'dnd');
    expect(dnd!.previousValue).toBe('off');

    // A capability the context never touched has no original to report.
    expect(await getOriginalValue(session.id, 'alarm')).toBeNull();
  });

  // ── TEST 5 — multiple capabilities under one context ───────────────────────
  it('D32-5: brightness and DND both appear under the same historical context', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82, capturedAt: 1 }),
    );
    await snapshotRepository.create(
      snap(session.id, { capability: 'dnd', previousValue: 'off', capturedAt: 2 }),
    );
    await endSession(session.id);

    const history = await getRestoreHistory(session.id);

    expect(history!.capabilities.sort()).toEqual(['brightness', 'dnd']);
    const byCapability = Object.fromEntries(
      history!.snapshots.map((s) => [s.capability, s.previousValue]),
    );
    expect(byCapability.brightness).toBe(82);
    expect(byCapability.dnd).toBe('off');
  });

  // ── TEST 6 — contexts never cross-contaminate ──────────────────────────────
  it('D32-6: history for one context never returns another context’s snapshots', async () => {
    const a = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    const b = await startSession({ profileId: SLEEP, now: 2000, durationMinutes: null });

    await snapshotRepository.create(snap(a.id, { capability: 'brightness', previousValue: 82 }));
    await snapshotRepository.create(snap(b.id, { capability: 'brightness', previousValue: 15 }));
    await endSession(a.id, { now: 3000 });
    await endSession(b.id, { now: 4000 });

    const historyA = await getRestoreHistory(a.id);
    const historyB = await getRestoreHistory(b.id);

    expect(historyA!.snapshots).toHaveLength(1);
    expect(historyA!.snapshots[0]!.previousValue).toBe(82);
    expect(historyB!.snapshots).toHaveLength(1);
    expect(historyB!.snapshots[0]!.previousValue).toBe(15);

    expect(historyA!.profile!.modeKey).toBe('study');
    expect(historyB!.profile!.modeKey).toBe('sleep');
  });

  it('D32-6b: per-profile history lists only that profile’s contexts', async () => {
    const a = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    const b = await startSession({ profileId: SLEEP, now: 2000, durationMinutes: null });
    await endSession(a.id, { now: 3000 });
    await endSession(b.id, { now: 4000 });

    const studyHistory = await listRestoreHistory(STUDY);
    const sleepHistory = await listRestoreHistory(SLEEP);

    expect(studyHistory.map((e) => e.session.id)).toContain(a.id);
    expect(studyHistory.map((e) => e.session.id)).not.toContain(b.id);
    expect(sleepHistory.map((e) => e.session.id)).toContain(b.id);
    expect(sleepHistory.map((e) => e.session.id)).not.toContain(a.id);
  });

  // ── TEST 7 — persistence beyond the session lifecycle ──────────────────────
  it('D32-7: history survives the context ending and is read back from SQLite', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82 }),
    );
    await endSession(session.id, { now: 9000 });

    // Straight from SQL, bypassing every helper above.
    const db = await getDatabase();
    const rows = await db.getAllAsync<ContextSession>(
      'SELECT id, profileId, startedAt, endsAt, status FROM context_session WHERE id = ?',
      [session.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endsAt).toBe(9000);

    const snapRows = await db.getAllAsync<{ previousValue: string }>(
      'SELECT previousValue FROM device_snapshot WHERE sessionId = ?',
      [session.id],
    );
    expect(snapRows).toHaveLength(1);
    expect(snapRows[0]!.previousValue).toBe('82');

    // And the assembled view agrees with the raw rows.
    const history = await getRestoreHistory(session.id);
    expect(history!.snapshots[0]!.previousValue).toBe(82);
  });

  it('D32-7b: completed and restorable contexts are listed after they end', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82 }),
    );

    // While running it is neither completed nor awaiting restore.
    expect(await listCompletedContexts(STUDY, 1500)).toHaveLength(0);

    await endSession(session.id, { now: 2000 });

    const completed = await listCompletedContexts(STUDY, 3000);
    expect(completed.map((e) => e.session.id)).toContain(session.id);

    const restorable = await listRestorableContexts(STUDY, 3000);
    expect(restorable.map((e) => e.session.id)).toContain(session.id);
    expect(restorable[0]!.restorable).toBe(true);
  });

  it('D32-7c: once snapshots are cleaned up the context is no longer restorable', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82 }),
    );
    await endSession(session.id, { now: 2000 });

    expect(await listRestorableContexts(STUDY, 3000)).toHaveLength(1);

    // Only legitimate after a verified restore.
    await snapshotRepository.cleanupSessionSnapshots(session.id);

    expect(await listRestorableContexts(STUDY, 3000)).toHaveLength(0);
    // The session itself is still history — the record is not destroyed.
    const history = await getRestoreHistory(session.id);
    expect(history).not.toBeNull();
    expect(history!.ended).toBe(true);
    expect(history!.restorable).toBe(false);
  });

  // ── TEST 8 — D3.1 first-write-wins regression ──────────────────────────────
  it('D32-8: history reports the first captured value, never a later overwrite', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });

    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82, capturedAt: 1000 }),
    );
    // A careless re-capture taken after the context already dimmed the screen.
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 40, capturedAt: 2000 }),
    );
    await endSession(session.id);

    const history = await getRestoreHistory(session.id);

    expect(history!.snapshots).toHaveLength(1);
    expect(history!.snapshots[0]!.previousValue).toBe(82);
    expect(history!.snapshots[0]!.previousValue).not.toBe(40);
  });

  // ── TEST 9 — restoration status uses the project's own vocabulary ──────────
  it('D32-9: the session lifecycle state persists and is exposed by history', async () => {
    const session = await startSession({ profileId: STUDY, durationMinutes: null });
    expect((await getRestoreHistory(session.id))!.session.status).toBe('READY');

    await markSessionActive(session.id);
    expect((await getRestoreHistory(session.id))!.session.status).toBe('ACTIVE');

    // PARTIAL is the project's existing term for "restore did not fully succeed"
    // (SessionState, types/policy.ts). No new status vocabulary is introduced.
    await endSession(session.id, { status: 'PARTIAL' });
    const history = await getRestoreHistory(session.id);
    expect(history!.session.status).toBe('PARTIAL');
    // Snapshots are retained in that case so a retry is still possible.
    expect(history!.ended).toBe(true);
  });

  // ── TEST 10 — reading history changes nothing ──────────────────────────────
  it('D32-10: repeated retrieval neither duplicates nor mutates history', async () => {
    const session = await startSession({ profileId: STUDY, now: 1000, durationMinutes: null });
    await snapshotRepository.create(
      snap(session.id, { capability: 'brightness', previousValue: 82 }),
    );
    await snapshotRepository.create(snap(session.id, { capability: 'dnd', previousValue: 'off' }));
    await endSession(session.id, { now: 2000 });

    const first = await getRestoreHistory(session.id);

    for (let i = 0; i < 5; i++) {
      await getRestoreHistory(session.id);
      await listRestoreHistory(STUDY);
      await listCompletedContexts(STUDY, 3000);
      await listRestorableContexts(STUDY, 3000);
    }

    const after = await getRestoreHistory(session.id);
    expect(after).toEqual(first);

    // Row counts are unchanged — nothing here writes.
    const db = await getDatabase();
    const sessions = await db.getAllAsync('SELECT id FROM context_session WHERE id = ?', [
      session.id,
    ]);
    const snaps = await db.getAllAsync('SELECT id FROM device_snapshot WHERE sessionId = ?', [
      session.id,
    ]);
    expect(sessions).toHaveLength(1);
    expect(snaps).toHaveLength(2);
  });
});
