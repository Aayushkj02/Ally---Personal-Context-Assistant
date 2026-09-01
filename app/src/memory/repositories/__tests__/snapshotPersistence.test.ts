/**
 * OWNER: DHREY — task D3.1 (Full Snapshot Persistence)
 *
 * Exercises the real snapshotRepository against real SQLite (better-sqlite3 in-memory
 * via setupTests.ts). Nothing is mocked away: every assertion below is the result of an
 * actual INSERT and an actual SELECT.
 *
 * The property under test is the one restoration cannot get wrong — the value stored is
 * the value that existed BEFORE the context changed anything, and no later write may
 * replace it.
 */

import { getDatabase } from '../../database';
import { ensureSeeded, startSession } from '../../index';
import { snapshotRepository } from '../snapshotRepository';
import type { ContextSession, DeviceSnapshot } from '../../../types';

const STUDY = 'profile_study';
const SLEEP = 'profile_sleep';

/** A NotificationManager.Policy as the native layer reports it, JSON-encoded. */
const POLICY_BLOB = JSON.stringify({
  priorityCategories: ['ALARMS', 'MEDIA'],
  priorityCallSenders: 'STARRED',
  suppressedVisualEffects: 0,
});

function snapshot(over: Partial<DeviceSnapshot> & { sessionId: string }): DeviceSnapshot {
  return {
    id: `snap_${Math.random().toString(36).slice(2, 10)}`,
    capability: 'brightness',
    previousValue: 82,
    capturedAt: 1_700_000_000_000,
    ...over,
  };
}

/** Read straight from SQL, bypassing the repository, to prove the row is really stored. */
async function rawRows(sessionId: string) {
  const db = await getDatabase();
  return db.getAllAsync<{ id: string; capability: string; previousValue: string | null }>(
    'SELECT id, capability, previousValue FROM device_snapshot WHERE sessionId = ?',
    [sessionId],
  );
}

describe('D3.1 full snapshot persistence', () => {
  let session: ContextSession;

  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  beforeEach(async () => {
    // A fresh session per test: device_snapshot has a FK to context_session.
    session = await startSession({ profileId: STUDY, durationMinutes: null });
  });

  afterEach(async () => {
    await snapshotRepository.cleanupSessionSnapshots(session.id);
  });

  // ── TEST 1 — creation ──────────────────────────────────────────────────────
  it('D31-1: a snapshot of the real pre-context state is persisted', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 82 }),
    );

    // Present in SQLite, not merely in a JS object.
    const rows = await rawRows(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.capability).toBe('brightness');
    expect(rows[0]!.previousValue).toBe('82');
  });

  // ── TEST 2 — retrieval by session ──────────────────────────────────────────
  it('D31-2: the snapshot is retrievable by its session, exactly as written', async () => {
    const original = snapshot({ sessionId: session.id, previousValue: 82 });
    await snapshotRepository.create(original);

    const retrieved = await snapshotRepository.getBySession(session.id);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toEqual(original);
  });

  it('D31-2b: a single capability can be retrieved directly', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: 'off' }),
    );

    const dnd = await snapshotRepository.getForCapability(session.id, 'dnd');
    expect(dnd).not.toBeNull();
    expect(dnd!.previousValue).toBe('off');

    // A capability never captured reports null rather than a fabricated default.
    expect(await snapshotRepository.getForCapability(session.id, 'ringer')).toBeNull();
  });

  // ── TEST 3 — brightness ────────────────────────────────────────────────────
  it('D31-3: brightness survives as the exact number, not a string', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 82 }),
    );

    const stored = await snapshotRepository.getForCapability(session.id, 'brightness');
    expect(stored!.previousValue).toBe(82);
    expect(typeof stored!.previousValue).toBe('number');
    // 82 must not come back as "82" — restoration would then set a nonsense value.
    expect(stored!.previousValue).not.toBe('82');
  });

  it('D31-3b: 0 is preserved and never confused with null or absent', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 0 }),
    );

    const stored = await snapshotRepository.getForCapability(session.id, 'brightness');
    expect(stored!.previousValue).toBe(0);
    expect(stored!.previousValue).not.toBeNull();
  });

  // ── TEST 4 — DND interruption filter ───────────────────────────────────────
  it('D31-4: the DND interruption filter survives as its exact value', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: 'priority' }),
    );

    const stored = await snapshotRepository.getForCapability(session.id, 'dnd');
    expect(stored!.previousValue).toBe('priority');
    expect(typeof stored!.previousValue).toBe('string');
  });

  // ── TEST 5 — NotificationManager.Policy ────────────────────────────────────
  it('D31-5: a NotificationManager.Policy blob round-trips byte-exact', async () => {
    // CapabilityValue is `string | number`, so the policy travels as a JSON string.
    // The repository is value-agnostic: whatever the native layer captured comes back
    // character-for-character, with no reformatting or key reordering.
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: POLICY_BLOB }),
    );

    const stored = await snapshotRepository.getForCapability(session.id, 'dnd');
    expect(stored!.previousValue).toBe(POLICY_BLOB);

    const reparsed = JSON.parse(stored!.previousValue as string);
    expect(reparsed.priorityCategories).toEqual(['ALARMS', 'MEDIA']);
    expect(reparsed.priorityCallSenders).toBe('STARRED');
    expect(reparsed.suppressedVisualEffects).toBe(0);
  });

  it('D31-5b: an unreadable value is stored as null, never as a default', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'ringer', previousValue: null }),
    );

    const stored = await snapshotRepository.getForCapability(session.id, 'ringer');
    expect(stored!.previousValue).toBeNull();
    // "we could not read this" must not become 0, '' or 'normal'.
    expect(stored!.previousValue).not.toBe(0);
    expect(stored!.previousValue).not.toBe('');
  });

  // ── TEST 6 — first-write-wins ──────────────────────────────────────────────
  it('D31-6: a later write never replaces the original', async () => {
    const original = snapshot({
      sessionId: session.id,
      capability: 'brightness',
      previousValue: 82,
      capturedAt: 1000,
    });
    await snapshotRepository.create(original);

    // What a careless re-capture AFTER the context dimmed the screen would record.
    const later = snapshot({
      sessionId: session.id,
      capability: 'brightness',
      previousValue: 40,
      capturedAt: 2000,
    });
    await snapshotRepository.create(later);

    const stored = await snapshotRepository.getForCapability(session.id, 'brightness');
    expect(stored!.previousValue).toBe(82);
    expect(stored!.previousValue).not.toBe(40);
    expect(stored!.id).toBe(original.id);
    expect(stored!.capturedAt).toBe(1000);
  });

  it('D31-6b: captureOnce returns the authoritative original, not what it was handed', async () => {
    const first = await snapshotRepository.captureOnce(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 82 }),
    );
    expect(first.previousValue).toBe(82);

    const second = await snapshotRepository.captureOnce(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 40 }),
    );

    // The caller learns what restoration will actually use.
    expect(second.previousValue).toBe(82);
    expect(second.id).toBe(first.id);
  });

  // ── TEST 7 — duplicate writes ──────────────────────────────────────────────
  it('D31-7: repeated identical writes neither throw nor duplicate', async () => {
    const original = snapshot({
      sessionId: session.id,
      capability: 'brightness',
      previousValue: 82,
    });

    for (let i = 0; i < 5; i++) {
      await expect(snapshotRepository.create(original)).resolves.toBeUndefined();
    }

    const rows = await rawRows(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.previousValue).toBe('82');
  });

  it('D31-7b: conflicting writes leave exactly one row, and it is the original', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: 'off' }),
    );
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: 'priority' }),
    );
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: 'alarms' }),
    );

    const rows = await rawRows(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.previousValue).toBe('"off"');

    const list = await snapshotRepository.getBySession(session.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.previousValue).toBe('off');
  });

  it('D31-7c: different capabilities in one session are separate rows', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 82 }),
    );
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: 'off' }),
    );
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'ringer', previousValue: 'normal' }),
    );

    const list = await snapshotRepository.getBySession(session.id);
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.capability).sort()).toEqual(['brightness', 'dnd', 'ringer']);
  });

  // ── TEST 8 — multiple contexts ─────────────────────────────────────────────
  it('D31-8: snapshots never cross-contaminate between sessions', async () => {
    const other = await startSession({ profileId: SLEEP, durationMinutes: null });

    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 82 }),
    );
    await snapshotRepository.create(
      snapshot({ sessionId: other.id, capability: 'brightness', previousValue: 15 }),
    );

    const a = await snapshotRepository.getForCapability(session.id, 'brightness');
    const b = await snapshotRepository.getForCapability(other.id, 'brightness');

    expect(a!.previousValue).toBe(82);
    expect(b!.previousValue).toBe(15);
    expect(await snapshotRepository.getBySession(session.id)).toHaveLength(1);
    expect(await snapshotRepository.getBySession(other.id)).toHaveLength(1);

    await snapshotRepository.cleanupSessionSnapshots(other.id);
  });

  it('D31-8b: the same capability is capturable once per session, across sessions', async () => {
    const later = await startSession({ profileId: STUDY, durationMinutes: null });

    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'dnd', previousValue: 'off' }),
    );
    // A different session may capture 'dnd' again — the constraint is per session.
    await snapshotRepository.create(
      snapshot({ sessionId: later.id, capability: 'dnd', previousValue: 'priority' }),
    );

    expect((await snapshotRepository.getForCapability(session.id, 'dnd'))!.previousValue).toBe(
      'off',
    );
    expect((await snapshotRepository.getForCapability(later.id, 'dnd'))!.previousValue).toBe(
      'priority',
    );

    await snapshotRepository.cleanupSessionSnapshots(later.id);
  });

  // ── Enforcement lives in the database, not in caller discipline ────────────
  it('D31-7d: SQLite itself rejects a duplicate, so no code path can corrupt it', async () => {
    const db = await getDatabase();

    const indexes = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='device_snapshot'",
    );
    expect(indexes.map((i) => i.name)).toContain('idx_snapshot_session_capability');

    await db.runAsync(
      'INSERT INTO device_snapshot (id, sessionId, capability, previousValue, capturedAt) VALUES (?, ?, ?, ?, ?)',
      ['d31_raw_1', session.id, 'brightness', '82', 1],
    );

    // A caller bypassing the repository entirely still cannot overwrite the original.
    await expect(
      db.runAsync(
        'INSERT INTO device_snapshot (id, sessionId, capability, previousValue, capturedAt) VALUES (?, ?, ?, ?, ?)',
        ['d31_raw_2', session.id, 'brightness', '40', 2],
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/);

    const rows = await rawRows(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.previousValue).toBe('82');
  });

  // ── Persistence beyond the writing code path ───────────────────────────────
  it('D31-9: the snapshot outlives the context that created it', async () => {
    await snapshotRepository.create(
      snapshot({ sessionId: session.id, capability: 'brightness', previousValue: 82 }),
    );

    // The context runs and the device changes — none of which touches the snapshot.
    const { endSession } = await import('../../index');
    await endSession(session.id);

    const stored = await snapshotRepository.getForCapability(session.id, 'brightness');
    expect(stored!.previousValue).toBe(82);

    // Still in SQLite, so a later process can read it back for restoration.
    const rows = await rawRows(session.id);
    expect(rows).toHaveLength(1);
  });
});
