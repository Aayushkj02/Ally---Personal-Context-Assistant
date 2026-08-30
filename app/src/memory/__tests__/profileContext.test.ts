/**
 * OWNER: DHREY — task D-V3 (Profile / Memory Lookup)
 *
 * Exercises the real repositories against the in-memory SQLite the other D1 tests use.
 * Nothing here fakes the memory layer.
 */

import { getDatabase } from '../database';
import {
  ensureSeeded,
  knownActivities,
  loadContextForProfile,
  loadProfileContext,
  resolveProfileForActivity,
} from '../index';
import {
  overrideRepository,
  priorityRepository,
  profileRepository,
  sessionRepository,
  snapshotRepository,
} from '../repositories';
import { activateFromText } from '../../services/contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import type { ParseResult } from '../../types';

const STUDY = 'profile_study';
const SLEEP = 'profile_sleep';

/** The offline production path: real FallbackParser + real validator. */
const offlineEngine = {
  async parse(text: string): Promise<ParseResult> {
    const result = await new FallbackParser().parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

describe('D-V3 profile / memory lookup', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(async () => {
    await priorityRepository.clearProfile(STUDY);
    await priorityRepository.clearProfile(SLEEP);
  });

  // ── Test 1 / 2 — activity → profile ────────────────────────────────────────
  it('DV3-1: study resolves to the Study profile', async () => {
    const profile = await resolveProfileForActivity('study');

    expect(profile).not.toBeNull();
    expect(profile!.modeKey).toBe('study');
    expect(profile!.name).toBe('Study');
    expect(profile!.id).toBe(STUDY);
  });

  it('DV3-2: sleep resolves to the Sleep profile', async () => {
    const profile = await resolveProfileForActivity('sleep');

    expect(profile).not.toBeNull();
    expect(profile!.modeKey).toBe('sleep');
    expect(profile!.name).toBe('Sleep');
    expect(profile!.id).toBe(SLEEP);
  });

  it('DV3-2b: lookup is case- and whitespace-insensitive', async () => {
    const upper = await resolveProfileForActivity('Study');
    const padded = await resolveProfileForActivity('  study  ');

    expect(upper?.id).toBe(STUDY);
    expect(padded?.id).toBe(STUDY);
  });

  // ── Test 3 — the mechanism is mode-agnostic (ADR-004) ──────────────────────
  it('DV3-3: every mode that exists as data resolves, with no per-mode branching', async () => {
    // This is the ADR-004 guarantee: adding a mode is data, not code. The day a
    // focus.json + widened contract lands, focus resolves here with no change to
    // profileContext.ts, and this test covers it automatically.
    for (const activity of knownActivities()) {
      const profile = await resolveProfileForActivity(activity);
      expect(profile).not.toBeNull();
      expect(profile!.modeKey).toBe(activity);
    }
  });

  it('DV3-3b: an activity with no mode definition resolves to null, never a guess', async () => {
    expect(await resolveProfileForActivity('focus')).toBeNull();
    expect(await resolveProfileForActivity('unknown')).toBeNull();
    expect(await resolveProfileForActivity('')).toBeNull();
    expect(await loadProfileContext('focus')).toBeNull();
  });

  // ── Test 4 — preferences ───────────────────────────────────────────────────
  it("DV3-4: profile-specific preferences are loaded, and never another profile's", async () => {
    const pref = {
      id: 'dv3_pref_1',
      profileId: STUDY,
      capability: 'brightness' as const,
      value: 25,
      source: 'user' as const,
      sourceCommand: 'dim it to 25 when I study',
      createdAt: 1,
    };
    await profileRepository.createPreference(pref);

    const context = await loadProfileContext('study');
    expect(context).not.toBeNull();

    const loaded = context!.preferences.find((p) => p.id === 'dv3_pref_1');
    expect(loaded).toBeDefined();
    expect(loaded!.value).toBe(25);
    expect(loaded!.sourceCommand).toBe('dim it to 25 when I study');

    const sleepContext = await loadProfileContext('sleep');
    expect(sleepContext!.preferences.some((p) => p.id === 'dv3_pref_1')).toBe(false);

    await profileRepository.deletePreference('dv3_pref_1');
  });

  // ── Test 5 — temporary overrides, active vs expired ────────────────────────
  it('DV3-5: active overrides are loaded and expired ones are not', async () => {
    const now = Date.now();

    await overrideRepository.create({
      id: 'dv3_ovr_active',
      profileId: STUDY,
      capability: 'brightness',
      value: 70,
      subject: null,
      effect: 'allow',
      startAt: now - 1000,
      expiresAt: now + 60 * 60 * 1000,
      active: true,
      sourceCommand: 'brighten it for an hour',
    });

    await overrideRepository.create({
      id: 'dv3_ovr_expired',
      profileId: STUDY,
      capability: 'brightness',
      value: 90,
      subject: null,
      effect: 'allow',
      startAt: now - 7200_000,
      expiresAt: now - 3600_000,
      active: true,
      sourceCommand: 'brighten it (long expired)',
    });

    const context = await loadProfileContext('study');
    const ids = context!.overrides.map((o) => o.id);

    expect(ids).toContain('dv3_ovr_active');
    expect(ids).not.toContain('dv3_ovr_expired');

    await overrideRepository.delete('dv3_ovr_active');
    await overrideRepository.delete('dv3_ovr_expired');
  });

  // ── Test 6 — priority preferences ──────────────────────────────────────────
  it('DV3-6: priority settings are loaded for the profile and are mode-scoped', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
      sourceCommand: 'let Mom call me while I study',
    });
    await priorityRepository.addPreference({
      profileId: SLEEP,
      channel: 'calls',
      subject: 'Dad',
    });

    const study = await loadProfileContext('study');
    expect(study!.priorityPreferences.map((p) => p.subject)).toEqual(['Mom']);

    const sleep = await loadProfileContext('sleep');
    expect(sleep!.priorityPreferences.map((p) => p.subject)).toEqual(['Dad']);
  });

  // ── Test 7 — session / context ─────────────────────────────────────────────
  it('DV3-7: an open session for this profile is attached, with its snapshots', async () => {
    const now = Date.now();
    await sessionRepository.create({
      id: 'dv3_sess_1',
      profileId: STUDY,
      startedAt: now,
      endsAt: null,
      status: 'ACTIVE',
    });
    await snapshotRepository.create({
      id: 'dv3_snap_1',
      sessionId: 'dv3_sess_1',
      capability: 'brightness',
      previousValue: 80,
      capturedAt: now,
    });

    const context = await loadProfileContext('study');

    expect(context!.session).not.toBeNull();
    expect(context!.session!.id).toBe('dv3_sess_1');
    expect(context!.session!.startedAt).toBe(now);
    expect(context!.snapshots.map((s) => s.id)).toContain('dv3_snap_1');

    await sessionRepository.endSession('dv3_sess_1', 'RESTORING', now + 1);
  });

  it("DV3-7b: another profile's open session is never attached to this one", async () => {
    const now = Date.now();
    await sessionRepository.create({
      id: 'dv3_sess_sleep',
      profileId: SLEEP,
      startedAt: now,
      endsAt: null,
      status: 'ACTIVE',
    });

    const study = await loadProfileContext('study');
    expect(study!.session).toBeNull();
    expect(study!.snapshots).toEqual([]);

    const sleep = await loadProfileContext('sleep');
    expect(sleep!.session!.id).toBe('dv3_sess_sleep');

    await sessionRepository.endSession('dv3_sess_sleep', 'RESTORING', now + 1);
  });

  it('DV3-7c: loadContextForProfile aggregates for a profile already in hand', async () => {
    const profile = await profileRepository.getProfileByModeKey('study');
    const context = await loadContextForProfile(profile!);

    expect(context.profile.id).toBe(STUDY);
    expect(Array.isArray(context.preferences)).toBe(true);
    expect(Array.isArray(context.priorityPreferences)).toBe(true);
    expect(Array.isArray(context.overrides)).toBe(true);
    expect(Array.isArray(context.snapshots)).toBe(true);
  });

  // ── Test 8 — full D-V1 compatibility ───────────────────────────────────────
  it('DV3-8: Intent → memory lookup → policy → ActionPlan still works end to end', async () => {
    const outcome = await activateFromText("I'm going to study for two hours.", {
      engine: offlineEngine,
    });

    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    // The profile came from the memory lookup, not from anything invented.
    const stored = await profileRepository.getProfileByModeKey('study');
    expect(outcome.profile.id).toBe(stored!.id);
    expect(outcome.policy.profileId).toBe(stored!.id);
    expect(outcome.plan.actions.length).toBeGreaterThan(0);
  });

  it('DV3-8b: a stored preference loaded by D-V3 wins over the mode default in policy', async () => {
    // Proves the lookup is actually feeding policy: with no preference the mode default
    // (brightness 40, source `default`) wins; with one stored, `profile` wins.
    await profileRepository.createPreference({
      id: 'dv3_pref_2',
      profileId: STUDY,
      capability: 'brightness',
      value: 15,
      source: 'user',
      sourceCommand: 'I like it dark when I study',
      createdAt: 2,
    });

    const outcome = await activateFromText("I'm going to study for two hours.", {
      engine: offlineEngine,
    });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const brightness = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(brightness).toBeDefined();
    expect(brightness!.value).toBe(15);
    expect(brightness!.source).toBe('profile');

    await profileRepository.deletePreference('dv3_pref_2');
  });
});
