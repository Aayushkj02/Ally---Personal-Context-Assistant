import { resolve, buildActionPlan, resolveCapability, getActiveOverrides } from '../index';
import type { Intent, IntentException, RequestedChange } from '../../types/intent';
import type { ContextProfile, Preference, TemporaryOverride } from '../../types/models';
import type { Capability, CapabilityValue } from '../../types/capability';

const EMPTY_INTENT: Intent = {
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

const DUMMY_PROFILE: ContextProfile = {
  id: 'prof_1',
  name: 'Study',
  modeKey: 'study',
  createdAt: 0,
  updatedAt: 0,
};

describe('Ally Policy Engine - Mandatory Tests', () => {
  const NOW = 1000000;

  it('TEST 1: DEFAULT FALLBACK', () => {
    const entry = resolveCapability('brightness', EMPTY_INTENT, [], [], MODE_DEFAULTS);
    expect(entry?.source).toBe('default');
    expect(entry?.value).toBe(50);
  });

  it('TEST 2: PERSISTENT PREFERENCE', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    const entry = resolveCapability('brightness', EMPTY_INTENT, [], prefs, MODE_DEFAULTS);
    expect(entry?.source).toBe('profile');
    expect(entry?.value).toBe(40);
  });

  it('TEST 3: TEMPORARY OVERRIDE', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    const activeOverrides = getActiveOverrides(
      [
        {
          id: 'o1',
          profileId: 'prof_1',
          capability: 'brightness',
          value: 10,
          subject: null,
          effect: 'allow',
          startAt: NOW,
          expiresAt: NOW + 10000,
          active: true,
          sourceCommand: null,
        },
      ],
      'prof_1',
      NOW,
    );
    const entry = resolveCapability(
      'brightness',
      EMPTY_INTENT,
      activeOverrides,
      prefs,
      MODE_DEFAULTS,
    );
    expect(entry?.source).toBe('override');
    expect(entry?.value).toBe(10);
  });

  it('TEST 4: EXPIRED OVERRIDE', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    const activeOverrides = getActiveOverrides(
      [
        {
          id: 'o1',
          profileId: 'prof_1',
          capability: 'brightness',
          value: 10,
          subject: null,
          effect: 'allow',
          startAt: NOW - 20000,
          expiresAt: NOW - 10000,
          active: true,
          sourceCommand: null,
        },
      ],
      'prof_1',
      NOW,
    );

    // The activeOverrides array will be empty due to expiration
    expect(activeOverrides.length).toBe(0);

    const entry = resolveCapability(
      'brightness',
      EMPTY_INTENT,
      activeOverrides,
      prefs,
      MODE_DEFAULTS,
    );
    expect(entry?.source).toBe('profile');
    expect(entry?.value).toBe(40);
  });

  it('TEST 5: CURRENT INSTRUCTION', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    const activeOverrides = getActiveOverrides(
      [
        {
          id: 'o1',
          profileId: 'prof_1',
          capability: 'brightness',
          value: 10,
          subject: null,
          effect: 'allow',
          startAt: NOW,
          expiresAt: NOW + 10000,
          active: true,
          sourceCommand: null,
        },
      ],
      'prof_1',
      NOW,
    );
    const intent: Intent = {
      ...EMPTY_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 80 }],
    };
    const entry = resolveCapability('brightness', intent, activeOverrides, prefs, MODE_DEFAULTS);
    expect(entry?.source).toBe('command');
    expect(entry?.value).toBe(80);
  });

  it('TEST 6: REMOVE OVERRIDE', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    const entry = resolveCapability('brightness', EMPTY_INTENT, [], prefs, MODE_DEFAULTS);
    expect(entry?.source).toBe('profile');
    expect(entry?.value).toBe(40);
  });

  it('TEST 7: PROFILE ISOLATION', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_2',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    const activeOverrides = getActiveOverrides(
      [
        {
          id: 'o1',
          profileId: 'prof_OTHER',
          capability: 'brightness',
          value: 10,
          subject: null,
          effect: 'allow',
          startAt: NOW,
          expiresAt: NOW + 10000,
          active: true,
          sourceCommand: null,
        },
      ],
      'prof_1',
      NOW,
    );

    expect(activeOverrides.length).toBe(0);
  });

  it('TEST 8: MULTIPLE CAPABILITIES (Realistic Scenario)', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
      {
        id: 'p2',
        profileId: 'prof_1',
        capability: 'dnd',
        value: 'priority',
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];

    const intent: Intent = {
      ...EMPTY_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 60 }],
      exceptions: [
        { type: 'contactGroup', value: 'project group', effect: 'allow', durationMinutes: 20 },
      ],
    };

    const policy = resolve(intent, DUMMY_PROFILE, prefs, [], MODE_DEFAULTS, NOW);

    const brightnessEntry = policy.entries.find((e) => e.capability === 'brightness');
    const dndEntry = policy.entries.find((e) => e.capability === 'dnd');

    expect(brightnessEntry?.value).toBe(60);
    expect(brightnessEntry?.source).toBe('command');

    expect(dndEntry?.value).toBe('priority');
    expect(dndEntry?.source).toBe('profile');

    expect(policy.exceptions[0]?.subject).toBe('project group');
  });

  it('TEST 9: MULTIPLE OVERRIDES', () => {
    const activeOverrides = getActiveOverrides(
      [
        {
          id: 'o1',
          profileId: 'prof_1',
          capability: 'brightness',
          value: 10,
          subject: null,
          effect: 'allow',
          startAt: NOW - 5000,
          expiresAt: NOW + 5000,
          active: true,
          sourceCommand: null,
        },
        {
          id: 'o2',
          profileId: 'prof_1',
          capability: 'brightness',
          value: 20,
          subject: null,
          effect: 'allow',
          startAt: NOW - 1000,
          expiresAt: NOW + 10000,
          active: true,
          sourceCommand: null,
        },
      ],
      'prof_1',
      NOW,
    );

    const entry = resolveCapability('brightness', EMPTY_INTENT, activeOverrides, [], MODE_DEFAULTS);
    expect(entry?.source).toBe('override');
    expect(entry?.value).toBe(20);
  });

  it('TEST 10: UNKNOWN CAPABILITY', () => {
    const entry = resolveCapability(
      'made_up_capability' as Capability,
      EMPTY_INTENT,
      [],
      [],
      MODE_DEFAULTS,
    );
    expect(entry).toBeNull();
  });

  it('TEST 11: INVALID VALUE', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: -50,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    expect(() => {
      resolveCapability('brightness', EMPTY_INTENT, [], prefs, MODE_DEFAULTS);
    }).toThrow(/Invalid policy input/);
  });

  it('TEST 12: NO MUTATION', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];
    const intent: Intent = {
      ...EMPTY_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 80 }],
    };

    const prefsCopy = JSON.parse(JSON.stringify(prefs));
    const intentCopy = JSON.parse(JSON.stringify(intent));

    resolveCapability('brightness', intent, [], prefs, MODE_DEFAULTS);

    expect(prefs).toEqual(prefsCopy);
    expect(intent).toEqual(intentCopy);
  });

  it('TEST 13: DETERMINISM', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];

    const run1 = resolve(EMPTY_INTENT, DUMMY_PROFILE, prefs, [], MODE_DEFAULTS, NOW);
    const run2 = resolve(EMPTY_INTENT, DUMMY_PROFILE, prefs, [], MODE_DEFAULTS, NOW);

    expect(run1).toEqual(run2);
  });

  it('TEST 14: SOURCE INFORMATION', () => {
    const prefs: Preference[] = [
      {
        id: 'p1',
        profileId: 'prof_1',
        capability: 'brightness',
        value: 40,
        source: 'user',
        sourceCommand: null,
        createdAt: 0,
      },
    ];

    const policy = resolve(EMPTY_INTENT, DUMMY_PROFILE, prefs, [], MODE_DEFAULTS, NOW);
    const plan = buildActionPlan('s1', policy, 'session');

    const action = plan.actions.find((a) => a.capability === 'brightness');
    expect(action?.reason).toBe('from your active profile');
  });
});
