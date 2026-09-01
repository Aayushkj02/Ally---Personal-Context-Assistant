import { resolveCapability, getActiveOverrides } from '../rules';
import { buildActionPlan } from '../planner';
import type { Intent } from '../../types/intent';
import type { ContextProfile, Preference } from '../../types/models';

describe('Policy Engine Regression Suite (D7.2)', () => {
  const NOW = 1000000;
  const MODE_DEFAULTS = { dnd: 'off', brightness: 50, alarm: '07:00', ringer: 'normal' } as any;

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

  const PROFILE: ContextProfile = {
    id: 'prof_1',
    name: 'Test',
    modeKey: 'study',
    createdAt: 0,
    updatedAt: 0,
  };

  it('correctly orders precedence: Instruction > Override > Profile > Default', () => {
    // 1. Default
    let entry = resolveCapability('brightness', EMPTY_INTENT, [], [], MODE_DEFAULTS);
    expect(entry?.source).toBe('default');
    expect(entry?.value).toBe(50);

    // 2. Profile preference overrides default
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
    entry = resolveCapability('brightness', EMPTY_INTENT, [], prefs, MODE_DEFAULTS);
    expect(entry?.source).toBe('profile');
    expect(entry?.value).toBe(40);

    // 3. Active Override overrides preference
    const overrides = getActiveOverrides(
      [
        {
          id: 'o1',
          profileId: 'prof_1',
          capability: 'brightness',
          value: 30,
          subject: null,
          effect: 'allow',
          startAt: NOW,
          expiresAt: NOW + 1000,
          active: true,
          sourceCommand: null,
        },
      ],
      'prof_1',
      NOW,
    );
    entry = resolveCapability('brightness', EMPTY_INTENT, overrides, prefs, MODE_DEFAULTS);
    expect(entry?.source).toBe('override');
    expect(entry?.value).toBe(30);

    // 4. Intent instruction overrides all
    const intent: Intent = {
      ...EMPTY_INTENT,
      requestedChanges: [{ capability: 'brightness', value: 20 }],
    };
    entry = resolveCapability('brightness', intent, overrides, prefs, MODE_DEFAULTS);
    expect(entry?.source).toBe('command');
    expect(entry?.value).toBe(20);
  });

  it('generates a deterministic ActionPlan', () => {
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
    const overrides = getActiveOverrides(
      [
        {
          id: 'o1',
          profileId: 'prof_1',
          capability: 'dnd',
          value: 'priority',
          subject: null,
          effect: 'allow',
          startAt: NOW,
          expiresAt: NOW + 1000,
          active: true,
          sourceCommand: null,
        },
      ],
      'prof_1',
      NOW,
    );
    const intent: Intent = {
      ...EMPTY_INTENT,
      requestedChanges: [{ capability: 'ringer', value: 'silent' }],
    };

    // Need to resolve the policy first, since buildActionPlan takes a ResolvedPolicy, not the raw preferences
    const policy = {
      profileId: PROFILE.id,
      entries: [
        { capability: 'brightness', value: 40, source: 'profile', reason: 'preference' },
        { capability: 'dnd', value: 'priority', source: 'override', reason: 'override' },
        { capability: 'ringer', value: 'silent', source: 'command', reason: 'instruction' },
      ],
    } as any;

    const plan = buildActionPlan('session_123', policy, 'temporary');

    expect(plan.sessionId).toBe('session_123');

    // Brightness comes from profile
    expect(plan.actions.find((a) => a.capability === 'brightness')?.value).toBe(40);

    // DND comes from override
    expect(plan.actions.find((a) => a.capability === 'dnd')?.value).toBe('priority');

    // Ringer comes from instruction
    expect(plan.actions.find((a) => a.capability === 'ringer')?.value).toBe('silent');
  });
});
