/**
 * OWNER: DHREY — task D-V2
 *
 * Ported from feature/dhrey/priority-data-policy-ui.
 *
 * These assert the honesty rules, not just the mechanics: whatsapp is never reported as
 * enforced, and a silent device is never read as success.
 */

import { describeEnforcement, resolvePriority } from '../resolver/priorityResolver';
import type { ChannelEnforcement, Channel, PriorityPreference } from '../../types';

function pref(over: Partial<PriorityPreference> = {}): PriorityPreference {
  return {
    id: `pp_${Math.random().toString(36).slice(2, 8)}`,
    profileId: 'profile_study',
    channel: 'calls',
    subject: 'Mom',
    subjectKind: 'contact',
    enabled: true,
    enforceable: true,
    sourceCommand: null,
    createdAt: 1,
    ...over,
  };
}

describe('resolvePriority', () => {
  it("is mode-scoped — another mode's list never leaks in", () => {
    const resolved = resolvePriority('profile_study', [
      pref({ subject: 'Mom' }),
      pref({ profileId: 'profile_sleep', subject: 'Dad' }),
    ]);

    expect(resolved.subjects.calls).toEqual(['Mom']);
    expect(resolved.profileId).toBe('profile_study');
  });

  it('ignores disabled preferences without deleting them', () => {
    const resolved = resolvePriority('profile_study', [pref({ subject: 'Mom', enabled: false })]);

    expect(resolved.channels.calls).toBe(false);
    expect(resolved.subjects.calls).toEqual([]);
  });

  it('reduces named contacts to a channel switch, because Android has no per-contact scope', () => {
    const resolved = resolvePriority('profile_study', [
      pref({ subject: 'Mom' }),
      pref({ subject: 'Dad' }),
    ]);

    expect(resolved.channels.calls).toBe(true);
    expect(resolved.subjects.calls).toEqual(['Mom', 'Dad']);
  });

  it('flags enforceable-channel subjects as needing to be starred', () => {
    const resolved = resolvePriority('profile_study', [
      pref({ channel: 'calls', subject: 'Mom' }),
      pref({ channel: 'sms', subject: 'Dad', enforceable: true }),
      pref({ channel: 'whatsapp', subject: 'Ravi', enforceable: false }),
    ]);

    expect(resolved.requiresStarring.sort()).toEqual(['Dad', 'Mom']);
    // whatsapp subjects are not starrable — Android cannot act on them at all.
    expect(resolved.requiresStarring).not.toContain('Ravi');
  });

  it('marks whatsapp as preference-only whenever it is used', () => {
    const resolved = resolvePriority('profile_study', [
      pref({ channel: 'whatsapp', subject: 'Ravi', enforceable: false }),
    ]);

    expect(resolved.preferenceOnly).toContain('whatsapp');
  });

  it('reports no preference-only channels when only calls and sms are used', () => {
    const resolved = resolvePriority('profile_study', [
      pref({ channel: 'calls' }),
      pref({ channel: 'sms' }),
    ]);

    expect(resolved.preferenceOnly).toEqual([]);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = [pref({ subject: 'Mom' }), pref({ channel: 'sms', subject: 'Dad' })];
    const snapshot = JSON.stringify(input);

    const a = resolvePriority('profile_study', input);
    const b = resolvePriority('profile_study', input);

    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('describeEnforcement', () => {
  const enabledCalls = () => resolvePriority('profile_study', [pref({ channel: 'calls' })]);

  it('prefers what the device actually reported over what we asked for', () => {
    const reported: ChannelEnforcement[] = [
      { channel: 'calls', status: 'enforced', message: 'Active on your phone' },
    ];

    const described = describeEnforcement(enabledCalls(), reported);
    const calls = described.find((c) => c.channel === 'calls');

    expect(calls?.status).toBe('enforced');
  });

  it('never assumes success when the device said nothing', () => {
    const described = describeEnforcement(enabledCalls(), null);
    const calls = described.find((c) => c.channel === 'calls');

    expect(calls?.status).toBe('failed');
    expect(calls?.status).not.toBe('enforced');
  });

  it('degrades a silent whatsapp to preference_only, never to failed', () => {
    const resolved = resolvePriority('profile_study', [
      pref({ channel: 'whatsapp', subject: 'Ravi', enforceable: false }),
    ]);

    const described = describeEnforcement(resolved, null);
    const whatsapp = described.find((c) => c.channel === 'whatsapp');

    expect(whatsapp?.status).toBe('preference_only');
  });

  it('calls an unconfigured enforceable channel unsupported rather than failed', () => {
    const described = describeEnforcement(enabledCalls(), null);
    const sms = described.find((c) => c.channel === 'sms');

    expect(sms?.status).toBe('unsupported');
  });

  it('reports whatsapp as preference_only even with nothing configured', () => {
    const described = describeEnforcement(enabledCalls(), null);
    const whatsapp = described.find((c) => c.channel === 'whatsapp');

    // A platform property, not a property of the user's list.
    expect(whatsapp?.status).toBe('preference_only');
  });

  it('never reports whatsapp as enforced under any device report', () => {
    const resolved = resolvePriority('profile_study', [
      pref({ channel: 'whatsapp', subject: 'Ravi', enforceable: false }),
    ]);

    const described = describeEnforcement(resolved, null);
    for (const row of described) {
      if (row.channel === 'whatsapp') {
        expect(row.status).not.toBe('enforced');
      }
    }
  });

  it('covers every channel exactly once', () => {
    const described = describeEnforcement(enabledCalls(), null);
    const channels = described.map((c) => c.channel).sort();

    expect(channels).toEqual((['calls', 'sms', 'whatsapp'] as Channel[]).sort());
  });
});
