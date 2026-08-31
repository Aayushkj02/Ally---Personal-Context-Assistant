/**
 * OWNER: DHREY — task D3.4 (Temporary Overrides)
 *
 * Real overrideRepository, real SQLite, real D2 policy resolver. No override array is
 * faked in JavaScript and no repository is mocked — every expiry decision below is made
 * from values that survived an INSERT and a SELECT.
 *
 * All timestamps are explicit integers. Nothing here sleeps or uses a real timer.
 */

import { getDatabase } from '../database';
import {
  createTemporaryOverride,
  deactivateOverride,
  endSession,
  ensureSeeded,
  listActiveOverrides,
  listOverrideHistory,
  overrideRepository,
  profileRepository,
  startSession,
} from '../index';
import { getActiveOverrides, isOverrideActive, resolveCapability } from '../../policy';
import type { Capability, CapabilityValue, Intent, Preference } from '../../types';

const STUDY = 'profile_study';
const SLEEP = 'profile_sleep';

/** 18:00, as an absolute instant. Every test measures against this. */
const SIX_PM = 1_700_000_000_000;
const FIVE_PM = SIX_PM - 60 * 60_000;
const EIGHT_PM = SIX_PM + 2 * 60 * 60_000;

const MODE_DEFAULTS: Record<Capability, CapabilityValue> = {
  dnd: 'off',
  brightness: 90,
  alarm: '07:00',
  ringer: 'normal',
};

const BASE_INTENT: Intent = {
  activity: 'study',
  operation: 'activate',
  durationMinutes: null,
  schedule: null,
  persistence: 'session',
  requestedChanges: [],
  exceptions: [],
  confidence: 1,
  requiresConfirmation: false,
  rawText: '',
  source: 'fallback',
};

function preference(value: CapabilityValue, profileId = STUDY): Preference {
  return {
    id: `pref_${profileId}_${value}`,
    profileId,
    capability: 'brightness',
    value,
    source: 'user',
    sourceCommand: null,
    createdAt: 1,
  };
}

/** Resolve brightness the way production does: stored overrides → policy. */
async function resolveBrightness(profileId: string, now: number, preferences: Preference[]) {
  const stored = await overrideRepository.getActiveForProfile(profileId, now);
  const active = getActiveOverrides(stored, profileId, now);
  return resolveCapability('brightness', BASE_INTENT, active, preferences, MODE_DEFAULTS);
}

async function clearOverrides(profileId: string) {
  for (const o of await listOverrideHistory(profileId)) {
    await overrideRepository.delete(o.id);
  }
}

describe('D3.4 temporary overrides', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(async () => {
    await clearOverrides(STUDY);
    await clearOverrides(SLEEP);
  });

  // ── TEST 1 — creation and exact persistence ────────────────────────────────
  it('D34-1: an override persists every field it was created with', async () => {
    const created = await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      sourceCommand: 'dim it to 40 until six',
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    const stored = await overrideRepository.getById(created.id);

    expect(stored).not.toBeNull();
    expect(stored!.profileId).toBe(STUDY);
    expect(stored!.capability).toBe('brightness');
    expect(stored!.value).toBe(40);
    expect(stored!.startAt).toBe(FIVE_PM);
    expect(stored!.expiresAt).toBe(SIX_PM);
    expect(stored!.active).toBe(true);
    expect(stored!.sourceCommand).toBe('dim it to 40 until six');
  });

  it('D34-1b: a duration is converted once into an absolute expiry', async () => {
    const created = await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      durationMinutes: 60,
    });

    // Stored as an instant, so no "started counting at" state must be rebuilt later.
    expect(created.expiresAt).toBe(SIX_PM);
    expect((await overrideRepository.getById(created.id))!.expiresAt).toBe(SIX_PM);
  });

  it('D34-1c: an override with no stated end is refused, never given a default', async () => {
    await expect(
      createTemporaryOverride({ profileId: STUDY, capability: 'brightness', value: 40 }),
    ).rejects.toThrow(/exactly one of expiresAt or durationMinutes/);

    // Supplying both is equally ambiguous and equally refused.
    await expect(
      createTemporaryOverride({
        profileId: STUDY,
        capability: 'brightness',
        value: 40,
        expiresAt: SIX_PM,
        durationMinutes: 60,
      }),
    ).rejects.toThrow();

    expect(await listOverrideHistory(STUDY)).toHaveLength(0);
  });

  // ── TEST 2 / 3 / 4 — the active window ─────────────────────────────────────
  it('D34-2: before its expiry the override is active', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    const active = await listActiveOverrides(STUDY, SIX_PM - 1);
    expect(active).toHaveLength(1);
    expect(active[0]!.value).toBe(40);
  });

  it('D34-3: after its expiry the override is ignored', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    expect(await listActiveOverrides(STUDY, EIGHT_PM)).toHaveLength(0);
  });

  it('D34-4: at exactly the expiry instant it is already expired', async () => {
    const created = await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    // The bound is exclusive: "until 18:00" does not include 18:00.
    expect(await listActiveOverrides(STUDY, SIX_PM)).toHaveLength(0);
    expect(await listActiveOverrides(STUDY, SIX_PM - 1)).toHaveLength(1);

    // The repository's SQL and the policy predicate agree on the boundary.
    expect(isOverrideActive(created, SIX_PM)).toBe(false);
    expect(isOverrideActive(created, SIX_PM - 1)).toBe(true);
  });

  it('D34-4b: an override that has not started yet is not active', async () => {
    const created = await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: SIX_PM,
      expiresAt: EIGHT_PM,
    });

    expect(await listActiveOverrides(STUDY, FIVE_PM)).toHaveLength(0);
    expect(isOverrideActive(created, FIVE_PM)).toBe(false);
    expect(await listActiveOverrides(STUDY, SIX_PM)).toHaveLength(1);
  });

  it('D34-4c: the stored SQL filter and the policy predicate never disagree', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    const all = await listOverrideHistory(STUDY);
    for (const instant of [FIVE_PM - 1, FIVE_PM, SIX_PM - 1, SIX_PM, EIGHT_PM]) {
      const fromSql = await listActiveOverrides(STUDY, instant);
      const fromPolicy = getActiveOverrides(all, STUDY, instant);
      expect(fromSql.map((o) => o.id)).toEqual(fromPolicy.map((o) => o.id));
    }
  });

  // ── TEST 5 — fallback to the persistent preference ─────────────────────────
  it('D34-5: an active override wins, and after expiry the preference returns', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });
    const prefs = [preference(70)];

    const during = await resolveBrightness(STUDY, SIX_PM - 1, prefs);
    expect(during!.value).toBe(40);
    expect(during!.source).toBe('override');

    const after = await resolveBrightness(STUDY, EIGHT_PM, prefs);
    expect(after!.value).toBe(70);
    expect(after!.source).toBe('profile');
    // The expired override must never resurface.
    expect(after!.value).not.toBe(40);
  });

  it('D34-5b: with no preference, an expired override falls through to the default', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    const after = await resolveBrightness(STUDY, EIGHT_PM, []);
    expect(after!.value).toBe(90);
    expect(after!.source).toBe('default');
  });

  // ── TEST 6 — current instruction still outranks an override ────────────────
  it('D34-6: a current instruction beats an active override and the preference', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    const stored = await overrideRepository.getActiveForProfile(STUDY, SIX_PM - 1);
    const active = getActiveOverrides(stored, STUDY, SIX_PM - 1);
    const intent: Intent = {
      ...BASE_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 30 }],
    };

    const entry = resolveCapability('brightness', intent, active, [preference(70)], MODE_DEFAULTS);

    expect(entry!.value).toBe(30);
    expect(entry!.source).toBe('command');
  });

  // ── TEST 7 — contexts stay isolated ────────────────────────────────────────
  it('D34-7: an override in one context never applies to another', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });
    await createTemporaryOverride({
      profileId: SLEEP,
      capability: 'brightness',
      value: 10,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    const study = await resolveBrightness(STUDY, SIX_PM - 1, []);
    const sleep = await resolveBrightness(SLEEP, SIX_PM - 1, []);

    expect(study!.value).toBe(40);
    expect(sleep!.value).toBe(10);
    expect(await listActiveOverrides(STUDY, SIX_PM - 1)).toHaveLength(1);
  });

  // ── TEST 8 — subject-scoped overrides ──────────────────────────────────────
  it('D34-8: a subject exception is stored per subject and does not bleed', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: null,
      value: null,
      subject: 'project group',
      effect: 'allow',
      now: FIVE_PM,
      durationMinutes: 20,
      sourceCommand: 'let the project group through for 20 minutes',
    });
    await createTemporaryOverride({
      profileId: STUDY,
      capability: null,
      value: null,
      subject: 'Rahul',
      effect: 'block',
      now: FIVE_PM,
      durationMinutes: 20,
    });

    const active = await listActiveOverrides(STUDY, FIVE_PM + 60_000);
    const bySubject = Object.fromEntries(active.map((o) => [o.subject, o.effect]));

    expect(active).toHaveLength(2);
    expect(bySubject['project group']).toBe('allow');
    expect(bySubject['Rahul']).toBe('block');

    // A subject-only override carries no capability value to apply.
    for (const o of active) {
      expect(o.capability).toBeNull();
      expect(o.value).toBeNull();
    }
  });

  // ── TEST 9 — survives the session lifecycle ────────────────────────────────
  it('D34-9: an override outlives the context and still expires correctly', async () => {
    const session = await startSession({ profileId: STUDY, now: FIVE_PM, durationMinutes: null });
    const created = await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });
    await endSession(session.id, { now: FIVE_PM + 1000 });

    // Read back from SQLite after the context ended.
    const stored = await overrideRepository.getById(created.id);
    expect(stored).not.toBeNull();
    expect(stored!.expiresAt).toBe(SIX_PM);

    expect(await listActiveOverrides(STUDY, SIX_PM - 1)).toHaveLength(1);
    expect(await listActiveOverrides(STUDY, EIGHT_PM)).toHaveLength(0);
  });

  // ── TEST 10 — expiry keeps the record ──────────────────────────────────────
  it('D34-10: an expired override is retained as history, merely ignored by policy', async () => {
    const created = await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
      sourceCommand: 'dim it until six',
    });

    // Long after expiry:
    expect(await listActiveOverrides(STUDY, EIGHT_PM)).toHaveLength(0);

    // …the row is still there, with its provenance intact.
    const history = await listOverrideHistory(STUDY);
    expect(history.map((o) => o.id)).toContain(created.id);
    expect(history[0]!.sourceCommand).toBe('dim it until six');

    // Correctness never depended on deleting it.
    const db = await getDatabase();
    const rows = await db.getAllAsync('SELECT id FROM temporary_override WHERE id = ?', [
      created.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('D34-10b: deactivating early ends it without erasing it', async () => {
    const created = await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    expect(await listActiveOverrides(STUDY, FIVE_PM + 1000)).toHaveLength(1);

    await deactivateOverride(created.id);

    expect(await listActiveOverrides(STUDY, FIVE_PM + 1000)).toHaveLength(0);
    expect((await overrideRepository.getById(created.id))!.active).toBe(false);
    expect(await listOverrideHistory(STUDY)).toHaveLength(1);
  });

  // ── TEST 11 — repeated overrides resolve deterministically ─────────────────
  it('D34-11: concurrent overrides resolve by the documented rule, not ambiguously', async () => {
    // The schema intentionally allows several concurrent overrides; the resolver picks
    // the one expiring LAST, tie-broken by the later startAt (D2, unchanged).
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 50,
      now: FIVE_PM + 1000,
      expiresAt: EIGHT_PM,
    });

    const at = FIVE_PM + 2000;
    const runs = [];
    for (let i = 0; i < 5; i++) {
      runs.push((await resolveBrightness(STUDY, at, [preference(70)]))!.value);
    }

    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe(50);

    // Both rows persist; selection — not deletion — decides which one applies.
    expect(await listActiveOverrides(STUDY, at)).toHaveLength(2);

    // Once the later one lapses too, the preference returns.
    const after = await resolveBrightness(STUDY, EIGHT_PM + 1, [preference(70)]);
    expect(after!.value).toBe(70);
  });

  // ── TEST 12 / 13 — correct after a restart, in both directions ─────────────
  it('D34-12: a future expiry is still active when read much later', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: EIGHT_PM,
    });

    // Simulating a relaunch: nothing in memory, the answer comes from stored values.
    const reread = await overrideRepository.getActiveForProfile(STUDY, SIX_PM);
    expect(reread).toHaveLength(1);
    expect(reread[0]!.value).toBe(40);
  });

  it('D34-13: an override that lapsed while the app was closed is immediately inactive', async () => {
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });

    // Closed at 17:00, reopened at 20:00 — no catch-up job, no timer, correct at once.
    expect(await overrideRepository.getActiveForProfile(STUDY, EIGHT_PM)).toHaveLength(0);
    const resolved = await resolveBrightness(STUDY, EIGHT_PM, [preference(70)]);
    expect(resolved!.value).toBe(70);
  });

  // ── TEST 14 — expiry is mandatory ──────────────────────────────────────────
  it('D34-14: expiresAt is NOT NULL, so no override can become accidentally permanent', async () => {
    const db = await getDatabase();

    // The schema itself refuses a null expiry.
    await expect(
      db.runAsync(
        `INSERT INTO temporary_override
           (id, profileId, capability, value, subject, effect, startAt, expiresAt, active, sourceCommand)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['ovr_null', STUDY, 'brightness', '40', null, 'allow', FIVE_PM, null, 1, null],
      ),
    ).rejects.toThrow(/NOT NULL/i);

    expect(await listOverrideHistory(STUDY)).toHaveLength(0);
  });

  // ── Isolation from the rest of Phase 3 ─────────────────────────────────────
  it('D34-15: overrides are stored apart from snapshots and touch no snapshot row', async () => {
    const session = await startSession({ profileId: STUDY, now: FIVE_PM, durationMinutes: null });
    const { snapshotRepository } = await import('../index');

    await snapshotRepository.create({
      id: 'snap_d34',
      sessionId: session.id,
      capability: 'brightness',
      previousValue: 82,
      capturedAt: FIVE_PM,
    });
    await createTemporaryOverride({
      profileId: STUDY,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });
    await endSession(session.id, { now: SIX_PM });

    // The override changed nothing about the captured original (D3.1).
    const snapshot = await snapshotRepository.getForCapability(session.id, 'brightness');
    expect(snapshot!.previousValue).toBe(82);

    // And it is still 82 after the override has expired.
    expect(await listActiveOverrides(STUDY, EIGHT_PM)).toHaveLength(0);
    expect(
      (await snapshotRepository.getForCapability(session.id, 'brightness'))!.previousValue,
    ).toBe(82);

    await snapshotRepository.cleanupSessionSnapshots(session.id);
    const db = await getDatabase();
    await db.runAsync('DELETE FROM context_session WHERE id = ?', [session.id]);
  });

  it('D34-16: overrides are scoped to a profile that must exist', async () => {
    const study = await profileRepository.getProfileByModeKey('study');
    expect(study).not.toBeNull();

    const created = await createTemporaryOverride({
      profileId: study!.id,
      capability: 'brightness',
      value: 40,
      now: FIVE_PM,
      expiresAt: SIX_PM,
    });
    expect(created.profileId).toBe(study!.id);

    // The FK refuses an override attached to no context.
    await expect(
      createTemporaryOverride({
        profileId: 'profile_does_not_exist',
        capability: 'brightness',
        value: 40,
        now: FIVE_PM,
        expiresAt: SIX_PM,
      }),
    ).rejects.toThrow();
  });
});
