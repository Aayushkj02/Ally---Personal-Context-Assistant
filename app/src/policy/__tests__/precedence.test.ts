/**
 * OWNER: DHREY — task D-V4 (Policy Precedence)
 *
 * D2 already implements the ladder. This file closes the coverage gaps D-V4 names,
 * rather than restating what policy.test.ts already proves:
 *
 *   - the SECONDARY tie-break (startAt) when two overrides share an expiresAt
 *   - determinism across repeated runs with competing overrides
 *   - invalid values at the command and override tiers, not only the preference tier
 *   - that invalid input yields NO ActionPlan at all, rather than a partial one
 *   - that the winning VALUE (not just its reason) reaches the ActionPlan
 *   - the full Intent → memory → precedence → ActionPlan path for every tier
 *
 * policy.test.ts is left exactly as it was.
 */

import { getActiveOverrides, resolve, resolveCapability, buildActionPlan } from '../index';
import {
  loadProfileContext,
  ensureSeeded,
  overrideRepository,
  profileRepository,
} from '../../memory';
import { getDatabase } from '../../memory/database';
import { activateFromText } from '../../services/contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import type { Capability, CapabilityValue } from '../../types/capability';
import type { Intent, ParseResult } from '../../types/intent';
import type { ContextProfile, Preference, TemporaryOverride } from '../../types/models';

const NOW = 1_000_000;

const BASE_INTENT: Intent = {
  activity: 'unknown',
  operation: 'query',
  durationMinutes: null,
  schedule: null,
  persistence: 'unspecified',
  requestedChanges: [],
  exceptions: [],
  confidence: 1,
  requiresConfirmation: false,
  rawText: '',
  source: 'ollama',
};

const MODE_DEFAULTS: Record<Capability, CapabilityValue> = {
  dnd: 'off',
  brightness: 50,
  alarm: '07:00',
  ringer: 'normal',
};

const PROFILE: ContextProfile = {
  id: 'prof_1',
  name: 'Study',
  modeKey: 'study',
  createdAt: 0,
  updatedAt: 0,
};

function pref(value: CapabilityValue, capability: Capability = 'brightness'): Preference {
  return {
    id: `p_${capability}`,
    profileId: 'prof_1',
    capability,
    value,
    source: 'user',
    sourceCommand: null,
    createdAt: 0,
  };
}

function override(over: Partial<TemporaryOverride> = {}): TemporaryOverride {
  return {
    id: `o_${Math.random().toString(36).slice(2, 8)}`,
    profileId: 'prof_1',
    capability: 'brightness',
    value: 10,
    subject: null,
    effect: 'allow',
    startAt: NOW - 1000,
    expiresAt: NOW + 10_000,
    active: true,
    sourceCommand: null,
    ...over,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Pure precedence
// ───────────────────────────────────────────────────────────────────────────

describe('D-V4 precedence ladder', () => {
  it('DV4-1: current instruction beats override AND preference', () => {
    const intent: Intent = {
      ...BASE_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 80 }],
    };
    const active = getActiveOverrides([override({ value: 20 })], 'prof_1', NOW);

    const entry = resolveCapability('brightness', intent, active, [pref(40)], MODE_DEFAULTS);

    expect(entry?.value).toBe(80);
    expect(entry?.source).toBe('command');
  });

  it('DV4-2: active override beats preference', () => {
    const active = getActiveOverrides([override({ value: 20 })], 'prof_1', NOW);

    const entry = resolveCapability('brightness', BASE_INTENT, active, [pref(40)], MODE_DEFAULTS);

    expect(entry?.value).toBe(20);
    expect(entry?.source).toBe('override');
  });

  it('DV4-3: preference beats default', () => {
    const entry = resolveCapability('brightness', BASE_INTENT, [], [pref(40)], MODE_DEFAULTS);

    expect(entry?.value).toBe(40);
    expect(entry?.source).toBe('profile');
  });

  it('DV4-4: default wins when nothing above it exists', () => {
    const entry = resolveCapability('brightness', BASE_INTENT, [], [], MODE_DEFAULTS);

    expect(entry?.value).toBe(50);
    expect(entry?.source).toBe('default');
  });

  it('DV4-5: an expired override is ignored and the preference wins', () => {
    const active = getActiveOverrides(
      [override({ value: 20, startAt: NOW - 20_000, expiresAt: NOW - 10_000 })],
      'prof_1',
      NOW,
    );
    expect(active).toHaveLength(0);

    const entry = resolveCapability('brightness', BASE_INTENT, active, [pref(40)], MODE_DEFAULTS);

    expect(entry?.value).toBe(40);
    expect(entry?.source).toBe('profile');
  });

  it('DV4-5b: an override expiring exactly now is already expired', () => {
    // The filter is `expiresAt > now`, so the boundary is exclusive.
    const active = getActiveOverrides([override({ expiresAt: NOW })], 'prof_1', NOW);
    expect(active).toHaveLength(0);
  });

  it('DV4-5c: an expired override does not mutate the persistent preference', () => {
    const preferences = [pref(40)];
    const snapshot = JSON.stringify(preferences);

    const active = getActiveOverrides([override({ value: 20, expiresAt: NOW - 1 })], 'prof_1', NOW);
    resolveCapability('brightness', BASE_INTENT, active, preferences, MODE_DEFAULTS);

    expect(JSON.stringify(preferences)).toBe(snapshot);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Conflict resolution — the gap policy.test.ts leaves open
// ───────────────────────────────────────────────────────────────────────────

describe('D-V4 override conflict resolution', () => {
  it('DV4-6: the later expiresAt wins', () => {
    const active = getActiveOverrides(
      [
        override({ value: 10, expiresAt: NOW + 5_000 }),
        override({ value: 20, expiresAt: NOW + 10_000 }),
      ],
      'prof_1',
      NOW,
    );

    const entry = resolveCapability('brightness', BASE_INTENT, active, [], MODE_DEFAULTS);
    expect(entry?.value).toBe(20);
  });

  it('DV4-6b: on an expiresAt tie, the later startAt wins', () => {
    // This is the secondary tie-break, and nothing exercised it before.
    const active = getActiveOverrides(
      [
        override({ value: 10, startAt: NOW - 5_000, expiresAt: NOW + 10_000 }),
        override({ value: 20, startAt: NOW - 1_000, expiresAt: NOW + 10_000 }),
      ],
      'prof_1',
      NOW,
    );

    const entry = resolveCapability('brightness', BASE_INTENT, active, [], MODE_DEFAULTS);
    expect(entry?.value).toBe(20);
  });

  it('DV4-6c: the tie-break does not depend on input order', () => {
    const a = override({ value: 10, startAt: NOW - 5_000, expiresAt: NOW + 10_000 });
    const b = override({ value: 20, startAt: NOW - 1_000, expiresAt: NOW + 10_000 });

    const forward = resolveCapability(
      'brightness',
      BASE_INTENT,
      getActiveOverrides([a, b], 'prof_1', NOW),
      [],
      MODE_DEFAULTS,
    );
    const reversed = resolveCapability(
      'brightness',
      BASE_INTENT,
      getActiveOverrides([b, a], 'prof_1', NOW),
      [],
      MODE_DEFAULTS,
    );

    expect(forward?.value).toBe(20);
    expect(reversed?.value).toBe(20);
  });

  it('DV4-6d: repeated runs over competing overrides are identical', () => {
    const overrides = [
      override({ value: 10, expiresAt: NOW + 5_000 }),
      override({ value: 20, expiresAt: NOW + 10_000 }),
      override({ value: 30, startAt: NOW - 9_000, expiresAt: NOW + 10_000 }),
    ];

    const runs = Array.from({ length: 5 }, () =>
      resolve(BASE_INTENT, PROFILE, [], overrides, MODE_DEFAULTS, NOW),
    );

    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Fail-safe
// ───────────────────────────────────────────────────────────────────────────

describe('D-V4 invalid and unsupported values', () => {
  it('DV4-7: a negative brightness in a command is rejected', () => {
    const intent: Intent = {
      ...BASE_INTENT,
      requestedChanges: [{ capability: 'brightness', value: -50 }],
    };

    expect(() => resolveCapability('brightness', intent, [], [], MODE_DEFAULTS)).toThrow(
      /Invalid policy input/,
    );
  });

  it('DV4-7b: an out-of-range brightness is rejected', () => {
    const intent: Intent = {
      ...BASE_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 500 }],
    };

    expect(() => resolveCapability('brightness', intent, [], [], MODE_DEFAULTS)).toThrow(
      /Invalid policy input/,
    );
  });

  it('DV4-7c: an invalid enum value is rejected', () => {
    const intent: Intent = {
      ...BASE_INTENT,
      requestedChanges: [{ capability: 'dnd', value: 'sometimes' as CapabilityValue }],
    };

    expect(() => resolveCapability('dnd', intent, [], [], MODE_DEFAULTS)).toThrow(
      /Invalid policy input/,
    );
  });

  it('DV4-7d: an invalid value in an OVERRIDE is rejected', () => {
    const active = getActiveOverrides([override({ value: 900 })], 'prof_1', NOW);

    expect(() => resolveCapability('brightness', BASE_INTENT, active, [], MODE_DEFAULTS)).toThrow(
      /Invalid policy input/,
    );
  });

  it('DV4-7e: invalid input produces NO ActionPlan, not a partial one', () => {
    const intent: Intent = {
      ...BASE_INTENT,
      requestedChanges: [{ capability: 'brightness', value: -50 }],
    };

    // resolve() must fail before any plan can be built. A half-built plan reaching the
    // device layer is the failure mode this guards.
    let plan = null;
    expect(() => {
      const policy = resolve(intent, PROFILE, [], [], MODE_DEFAULTS, NOW);
      plan = buildActionPlan('s1', policy, 'session');
    }).toThrow(/Invalid policy input/);
    expect(plan).toBeNull();
  });

  it('DV4-8: an unsupported capability resolves to null rather than a guess', () => {
    const entry = resolveCapability('teleport' as Capability, BASE_INTENT, [], [], MODE_DEFAULTS);

    expect(entry).toBeNull();
  });

  it('DV4-8b: a capability outside the allow-list is ignored even if a mode file defines it', () => {
    // Iteration is driven by CAPABILITIES, not by whatever keys the input happens to
    // carry — so a bad mode file cannot smuggle an action into the plan.
    const pollutedDefaults = {
      ...MODE_DEFAULTS,
      teleport: 'on',
    } as unknown as Record<Capability, CapabilityValue>;

    const policy = resolve(BASE_INTENT, PROFILE, [], [], pollutedDefaults, NOW);
    const plan = buildActionPlan('s1', policy, 'session');

    expect(policy.entries.some((e) => (e.capability as string) === 'teleport')).toBe(false);
    expect(plan.actions.some((a) => (a.capability as string) === 'teleport')).toBe(false);
    // The four real capabilities still resolve.
    expect(plan.actions).toHaveLength(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ActionPlan carries the winning value
// ───────────────────────────────────────────────────────────────────────────

describe('D-V4 ActionPlan representation', () => {
  it('DV4-9: the winning value reaches the plan for every tier', () => {
    const intent: Intent = {
      ...BASE_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 80 }],
    };
    const overrides = [override({ capability: 'ringer', value: 'vibrate' })];
    const preferences = [pref('priority', 'dnd')];

    const policy = resolve(intent, PROFILE, preferences, overrides, MODE_DEFAULTS, NOW);
    const plan = buildActionPlan('s1', policy, 'session');

    const byCapability = Object.fromEntries(plan.actions.map((a) => [a.capability, a]));

    expect(byCapability.brightness?.value).toBe(80); // command
    expect(byCapability.ringer?.value).toBe('vibrate'); // override
    expect(byCapability.dnd?.value).toBe('priority'); // preference
    expect(byCapability.alarm?.value).toBe('07:00'); // default

    // Every resolved entry becomes exactly one action.
    expect(plan.actions).toHaveLength(policy.entries.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 10 — the whole path, no layer bypassed
// ───────────────────────────────────────────────────────────────────────────

describe('D-V4 precedence through the real pipeline', () => {
  const STUDY = 'profile_study';

  const offlineEngine = {
    async parse(text: string): Promise<ParseResult> {
      const result = await new FallbackParser().parse(text);
      return IntentValidator.validate(result as ParseResult);
    },
  };

  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  it('DV4-10a: with nothing stored, the mode default wins end to end', async () => {
    const outcome = await activateFromText("I'm going to study for two hours.", {
      engine: offlineEngine,
    });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const brightness = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(brightness?.value).toBe(40); // study.json
    expect(brightness?.source).toBe('default');
  });

  it('DV4-10b: a stored override beats the mode default end to end', async () => {
    const now = Date.now();
    await overrideRepository.create({
      id: 'dv4_ovr',
      profileId: STUDY,
      capability: 'brightness',
      value: 20,
      subject: null,
      effect: 'allow',
      startAt: now - 1000,
      expiresAt: now + 60 * 60 * 1000,
      active: true,
      sourceCommand: 'dim it for an hour',
    });

    const outcome = await activateFromText("I'm going to study for two hours.", {
      engine: offlineEngine,
    });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const brightness = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(brightness?.value).toBe(20);
    expect(brightness?.source).toBe('override');

    // and it reaches the plan
    const action = outcome.plan.actions.find((a) => a.capability === 'brightness');
    expect(action?.value).toBe(20);

    await overrideRepository.delete('dv4_ovr');
  });

  it('DV4-10c: an explicit instruction beats a stored override end to end', async () => {
    const now = Date.now();
    await overrideRepository.create({
      id: 'dv4_ovr2',
      profileId: STUDY,
      capability: 'brightness',
      value: 20,
      subject: null,
      effect: 'allow',
      startAt: now - 1000,
      expiresAt: now + 60 * 60 * 1000,
      active: true,
      sourceCommand: 'dim it for an hour',
    });

    const outcome = await activateFromText('I am going to study with brightness at 80', {
      engine: offlineEngine,
    });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const brightness = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(brightness?.value).toBe(80);
    expect(brightness?.source).toBe('command');

    const action = outcome.plan.actions.find((a) => a.capability === 'brightness');
    expect(action?.value).toBe(80);

    await overrideRepository.delete('dv4_ovr2');
  });

  it('DV4-10d: an expired stored override does not beat a stored preference', async () => {
    const now = Date.now();
    await overrideRepository.create({
      id: 'dv4_ovr_expired',
      profileId: STUDY,
      capability: 'brightness',
      value: 20,
      subject: null,
      effect: 'allow',
      startAt: now - 7_200_000,
      expiresAt: now - 3_600_000,
      active: true,
      sourceCommand: 'dimmed, long expired',
    });
    await profileRepository.createPreference({
      id: 'dv4_pref',
      profileId: STUDY,
      capability: 'brightness',
      value: 35,
      source: 'user',
      sourceCommand: 'I like 35 when studying',
      createdAt: 1,
    });

    // The memory layer must not hand policy an expired row in the first place.
    const context = await loadProfileContext('study');
    expect(context!.overrides.some((o) => o.id === 'dv4_ovr_expired')).toBe(false);

    const outcome = await activateFromText("I'm going to study for two hours.", {
      engine: offlineEngine,
    });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const brightness = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(brightness?.value).toBe(35);
    expect(brightness?.source).toBe('profile');

    await overrideRepository.delete('dv4_ovr_expired');
    await profileRepository.deletePreference('dv4_pref');
  });
});
