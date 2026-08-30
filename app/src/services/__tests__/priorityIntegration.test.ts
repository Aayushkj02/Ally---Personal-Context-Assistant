/**
 * OWNER: DHREY — task D-V5 (Priority Integration)
 *
 * The native seam is INJECTED to simulate the four device outcomes. Production code
 * still uses the real abstraction — no mock ever tells production that an unenforceable
 * channel is enforceable (STEP 15).
 */

import { getDatabase } from '../../memory/database';
import { ensureSeeded, priorityRepository, profileRepository } from '../../memory';
import {
  applyPriorityForActivity,
  applyPriorityForContext,
  buildPriorityRequest,
  type PriorityApplier,
} from '../priorityIntegration';
import { resolvePriority } from '../../policy';
import { activateFromText } from '../contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import { CHANNEL_ENFORCEABLE } from '../../types';
import type { ChannelEnforcement, ContextProfile, ParseResult } from '../../types';

const STUDY = 'profile_study';

const PROFILE: ContextProfile = {
  id: STUDY,
  name: 'Study',
  modeKey: 'study',
  createdAt: 0,
  updatedAt: 0,
};

/** No native module — what a Node process or an emulator without the dev build sees. */
const noDevice: PriorityApplier = () => null;

/** Android accepted and read the change back. */
const deviceEnforces: PriorityApplier = (prefs) => ({
  ok: true,
  channels: [
    ...(prefs.calls
      ? [
          {
            channel: 'calls' as const,
            status: 'enforced' as const,
            message: 'Active on your phone',
          },
        ]
      : []),
    ...(prefs.sms
      ? [{ channel: 'sms' as const, status: 'enforced' as const, message: 'Active on your phone' }]
      : []),
  ],
});

/** Android was asked and did not hold the change. */
const deviceFails: PriorityApplier = () => ({
  ok: false,
  channels: [{ channel: 'calls', status: 'failed', message: 'Android did not hold the change.' }],
});

/** The device cannot do this at all. */
const deviceUnsupported: PriorityApplier = () => ({
  ok: false,
  channels: [{ channel: 'calls', status: 'unsupported', message: 'Not supported on this device.' }],
});

/** The bridge threw. */
const deviceThrows: PriorityApplier = () => {
  throw new Error('bridge exploded');
};

function statusOf(rows: ChannelEnforcement[], channel: string) {
  return rows.find((r) => r.channel === channel)?.status;
}

const offlineEngine = {
  async parse(text: string): Promise<ParseResult> {
    const result = await new FallbackParser().parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

describe('D-V5 priority integration', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(async () => {
    await priorityRepository.clearProfile(STUDY);
  });

  // ── Test 1 / 2 — calls and SMS ────────────────────────────────────────────
  it('DV5-1: a calls preference resolves and is enforced when the device confirms', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
      sourceCommand: 'let Mom call me while I study',
    });

    const prefs = await priorityRepository.listForProfile(STUDY);
    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceEnforces });

    expect(outcome.resolved.channels.calls).toBe(true);
    expect(outcome.resolved.subjects.calls).toEqual(['Mom']);
    expect(outcome.request.calls).toBe(true);
    expect(statusOf(outcome.enforcement, 'calls')).toBe('enforced');
  });

  it('DV5-2: an SMS preference resolves and is enforced when the device confirms', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'sms',
      subject: 'Dad',
    });

    const prefs = await priorityRepository.listForProfile(STUDY);
    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceEnforces });

    expect(outcome.resolved.channels.sms).toBe(true);
    expect(outcome.request.sms).toBe(true);
    expect(statusOf(outcome.enforcement, 'sms')).toBe('enforced');
  });

  // ── Test 3 — WhatsApp is preference_only, always ──────────────────────────
  it('DV5-3: a WhatsApp preference is stored but reported preference_only, never enforced', async () => {
    const created = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
      sourceCommand: 'let Ravi message me',
    });

    // Stored and recognised.
    expect(created.enabled).toBe(true);
    expect(created.enforceable).toBe(false);

    const prefs = await priorityRepository.listForProfile(STUDY);
    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceEnforces });

    expect(outcome.resolved.channels.whatsapp).toBe(true);
    expect(outcome.resolved.preferenceOnly).toContain('whatsapp');
    expect(statusOf(outcome.enforcement, 'whatsapp')).toBe('preference_only');
    expect(statusOf(outcome.enforcement, 'whatsapp')).not.toBe('enforced');
  });

  it('DV5-3b: WhatsApp is never sent to Android, even when a device claims it enforced it', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
    });
    const prefs = await priorityRepository.listForProfile(STUDY);

    // A hostile/buggy device layer asserting WhatsApp enforcement.
    const lyingDevice: PriorityApplier = () => ({
      ok: true,
      channels: [
        { channel: 'whatsapp', status: 'enforced', message: 'totally enforced, trust me' },
      ],
    });

    let seen: unknown = null;
    const spy: PriorityApplier = (prefsIn) => {
      seen = prefsIn;
      return lyingDevice(prefsIn);
    };

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: spy });

    // The request carries no whatsapp field at all — structurally impossible to send.
    expect(Object.keys(seen as object).sort()).toEqual(['calls', 'repeatCallers', 'sms']);
    expect(CHANNEL_ENFORCEABLE.whatsapp).toBe(false);
    // We asked for nothing on whatsapp, so nothing we did caused that row.
    expect(outcome.request).not.toHaveProperty('whatsapp');
  });

  it('DV5-3c: WhatsApp stays preference_only with no device present', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
    });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: noDevice });

    expect(statusOf(outcome.enforcement, 'whatsapp')).toBe('preference_only');
  });

  // ── Test 4 — unsupported ──────────────────────────────────────────────────
  it('DV5-4: no native module reports unsupported, not failed', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: noDevice });

    // Nothing was attempted, so "unsupported" is the honest word (ADR-113).
    expect(statusOf(outcome.enforcement, 'calls')).toBe('unsupported');
    expect(statusOf(outcome.enforcement, 'calls')).not.toBe('failed');
    expect(statusOf(outcome.enforcement, 'calls')).not.toBe('enforced');
  });

  it('DV5-4b: a device reporting unsupported is passed through unchanged', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceUnsupported });

    expect(statusOf(outcome.enforcement, 'calls')).toBe('unsupported');
  });

  // ── Test 5 — failure is never success ─────────────────────────────────────
  it('DV5-5: a device failure reports failed, never enforced', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceFails });

    expect(statusOf(outcome.enforcement, 'calls')).toBe('failed');
    expect(statusOf(outcome.enforcement, 'calls')).not.toBe('enforced');
  });

  it('DV5-5b: a thrown bridge error reports failed, never enforced', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceThrows });

    expect(statusOf(outcome.enforcement, 'calls')).toBe('failed');
  });

  it('DV5-5c: a silent device is never read as success', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const silent: PriorityApplier = () => ({ ok: true, channels: [] });
    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: silent });

    expect(statusOf(outcome.enforcement, 'calls')).not.toBe('enforced');
    expect(statusOf(outcome.enforcement, 'calls')).toBe('failed');
  });

  // ── Test 6 — successful enforcement ───────────────────────────────────────
  it('DV5-6: a confirmed device change reports enforced', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'sms', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceEnforces });

    expect(statusOf(outcome.enforcement, 'calls')).toBe('enforced');
    expect(statusOf(outcome.enforcement, 'sms')).toBe('enforced');
  });

  it('DV5-6b: every channel is reported exactly once, in the four-state vocabulary', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceEnforces });

    expect(outcome.enforcement.map((r) => r.channel).sort()).toEqual(['calls', 'sms', 'whatsapp']);
    for (const row of outcome.enforcement) {
      expect(['enforced', 'preference_only', 'unsupported', 'failed']).toContain(row.status);
      expect(typeof row.message).toBe('string');
    }
  });

  // ── Test 7 — determinism ──────────────────────────────────────────────────
  it('DV5-7: the same inputs produce the same result every time', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
    });
    const prefs = await priorityRepository.listForProfile(STUDY);

    const runs = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await applyPriorityForContext(PROFILE, prefs, { applier: deviceEnforces }));
    }

    for (const run of runs) {
      expect(run.enforcement).toEqual(runs[0]!.enforcement);
      expect(run.request).toEqual(runs[0]!.request);
      expect(run.resolved).toEqual(runs[0]!.resolved);
    }
  });

  // ── Test 8 — the emergency safety net (ADR-109) ───────────────────────────
  it('DV5-8: the repeat-caller bypass is on in every request', async () => {
    // With a full list.
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const withCalls = await priorityRepository.listForProfile(STUDY);
    const a = await applyPriorityForContext(PROFILE, withCalls, { applier: deviceEnforces });
    expect(a.request.repeatCallers).toBe(true);

    // With whatsapp only — no enforceable channel requested.
    await priorityRepository.clearProfile(STUDY);
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
    });
    const whatsappOnly = await priorityRepository.listForProfile(STUDY);
    const b = await applyPriorityForContext(PROFILE, whatsappOnly, { applier: deviceEnforces });
    expect(b.request.repeatCallers).toBe(true);
    expect(b.request.calls).toBe(false);

    // With nothing stored at all.
    await priorityRepository.clearProfile(STUDY);
    const c = await applyPriorityForContext(PROFILE, [], { applier: deviceEnforces });
    expect(c.request.repeatCallers).toBe(true);
  });

  it('DV5-8b: turning every priority preference off cannot disable the bypass', async () => {
    const created = await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
    });
    await priorityRepository.setEnabled(created.id, false);
    const prefs = await priorityRepository.listForProfile(STUDY);

    const outcome = await applyPriorityForContext(PROFILE, prefs, { applier: deviceEnforces });

    expect(outcome.resolved.channels.calls).toBe(false);
    // Ordinary priority rules narrowed to nothing; the safety net did not narrow with them.
    expect(outcome.request.repeatCallers).toBe(true);
  });

  it('DV5-8c: buildPriorityRequest never emits a request with the bypass off', () => {
    const configurations = [
      resolvePriority(STUDY, []),
      resolvePriority(STUDY, [
        {
          id: 'x',
          profileId: STUDY,
          channel: 'calls',
          subject: 'Mom',
          subjectKind: 'contact',
          enabled: true,
          enforceable: true,
          sourceCommand: null,
          createdAt: 0,
        },
      ]),
    ];

    for (const resolved of configurations) {
      expect(buildPriorityRequest(resolved).repeatCallers).toBe(true);
    }
  });

  // ── The default (uninjected) path fails safe ──────────────────────────────
  it('DV5-6c: with NO applier injected, the real seam degrades to unsupported', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    const prefs = await priorityRepository.listForProfile(STUDY);

    // No `applier` in deps: production wiring is used. In a Node process the native
    // module is absent (and `expo` is ESM, which this transform cannot load), so the
    // seam yields nothing. The rule that matters is the direction of the degradation —
    // never toward `enforced`.
    const outcome = await applyPriorityForContext(PROFILE, prefs);

    expect(statusOf(outcome.enforcement, 'calls')).toBe('unsupported');
    expect(statusOf(outcome.enforcement, 'calls')).not.toBe('enforced');
    expect(statusOf(outcome.enforcement, 'whatsapp')).toBe('preference_only');
    // The safety net is still requested even on the degraded path.
    expect(outcome.request.repeatCallers).toBe(true);
  });

  // ── Test 9 — memory integration ───────────────────────────────────────────
  it('DV5-9: preferences come from the repository, not from anything hardcoded', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Grandma',
      sourceCommand: 'let Grandma ring through',
    });

    const outcome = await applyPriorityForActivity('study', { applier: deviceEnforces });

    expect(outcome).not.toBeNull();
    expect(outcome!.profileId).toBe(STUDY);
    expect(outcome!.resolved.subjects.calls).toEqual(['Grandma']);
    // Provenance survives the round trip.
    expect(outcome!.preferences[0]!.sourceCommand).toBe('let Grandma ring through');
  });

  it('DV5-9b: an activity with no profile returns null rather than acting on nothing', async () => {
    expect(await applyPriorityForActivity('focus', { applier: deviceEnforces })).toBeNull();
  });

  it('DV5-9c: priority is mode-scoped end to end', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });
    await priorityRepository.addPreference({
      profileId: 'profile_sleep',
      channel: 'calls',
      subject: 'Dad',
    });

    const study = await applyPriorityForActivity('study', { applier: deviceEnforces });
    const sleep = await applyPriorityForActivity('sleep', { applier: deviceEnforces });

    expect(study!.resolved.subjects.calls).toEqual(['Mom']);
    expect(sleep!.resolved.subjects.calls).toEqual(['Dad']);

    await priorityRepository.clearProfile('profile_sleep');
  });

  // ── Test 10 — D-V1 / D-V3 / D-V4 still intact ─────────────────────────────
  it('DV5-10: Intent → memory → policy → ActionPlan is unaffected by priority handling', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });

    const outcome = await activateFromText("I'm going to study for two hours.", {
      engine: offlineEngine,
    });

    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const stored = await profileRepository.getProfileByModeKey('study');
    expect(outcome.profile.id).toBe(stored!.id);
    expect(outcome.plan.actions.length).toBeGreaterThan(0);

    // D-V4 precedence is untouched: no priority row leaked into the capability ladder.
    const brightness = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(brightness?.value).toBe(40);
    expect(brightness?.source).toBe('default');

    // ActionPlan carries only capabilities, never channels.
    for (const action of outcome.plan.actions) {
      expect(['calls', 'sms', 'whatsapp']).not.toContain(action.capability as string);
    }
  });
});
