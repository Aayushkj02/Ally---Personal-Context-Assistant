import { describe, expect, it } from '@jest/globals';

import type { PriorityPreference } from '../../types';
import { describeEnforcement, resolvePriority } from '../resolver';

const pref = (o: Partial<PriorityPreference>): PriorityPreference => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  profileId: o.profileId ?? 'sleep',
  channel: o.channel ?? 'calls',
  subject: o.subject ?? 'Mom',
  subjectKind: o.subjectKind ?? 'contact',
  enabled: o.enabled ?? true,
  enforceable: o.enforceable ?? true,
  sourceCommand: o.sourceCommand ?? null,
  createdAt: o.createdAt ?? 0,
});

describe('resolvePriority', () => {
  it("is mode-scoped — another mode's list never leaks in", () => {
    const r = resolvePriority('sleep', [
      pref({ profileId: 'sleep', channel: 'calls', subject: 'Mom' }),
      pref({ profileId: 'study', channel: 'calls', subject: 'Manager' }),
    ]);
    expect(r.subjects.calls).toEqual(['Mom']);
  });

  it('ignores disabled preferences without deleting them', () => {
    const r = resolvePriority('sleep', [
      pref({ channel: 'calls', subject: 'Mom', enabled: false }),
    ]);
    expect(r.channels.calls).toBe(false);
    expect(r.subjects.calls).toEqual([]);
  });

  it('reduces named contacts to a channel switch, because Android has no per-contact scope', () => {
    const r = resolvePriority('sleep', [
      pref({ channel: 'calls', subject: 'Mom' }),
      pref({ channel: 'calls', subject: 'Dad' }),
    ]);
    expect(r.channels.calls).toBe(true);
    expect(r.subjects.calls).toEqual(['Mom', 'Dad']);
  });

  it('flags enforceable-channel subjects as needing to be starred', () => {
    const r = resolvePriority('sleep', [
      pref({ channel: 'calls', subject: 'Mom' }),
      pref({ channel: 'sms', subject: 'Mom' }),
      pref({ channel: 'whatsapp', subject: 'Family Group', subjectKind: 'contactGroup' }),
    ]);
    // Mom appears on two enforceable channels but must only be listed once.
    expect(r.requiresStarring).toEqual(['Mom']);
    // WhatsApp cannot be enforced, so starring would not help and it is excluded.
    expect(r.requiresStarring).not.toContain('Family Group');
  });

  it('marks whatsapp as preference-only whenever it is used', () => {
    const r = resolvePriority('sleep', [
      pref({ channel: 'whatsapp', subject: 'Family Group', enforceable: false }),
    ]);
    expect(r.preferenceOnly).toEqual(['whatsapp']);
    expect(r.channels.whatsapp).toBe(true);
  });

  it('reports no preference-only channels when only calls and sms are used', () => {
    const r = resolvePriority('study', [
      pref({ profileId: 'study', channel: 'calls', subject: 'Manager' }),
      pref({ profileId: 'study', channel: 'sms', subject: 'Manager' }),
    ]);
    expect(r.preferenceOnly).toEqual([]);
  });
});

describe('describeEnforcement', () => {
  it('prefers what the device actually reported over what we asked for', () => {
    const resolved = resolvePriority('sleep', [pref({ channel: 'calls', subject: 'Mom' })]);
    const rows = describeEnforcement(resolved, [
      { channel: 'calls', status: 'enforced', message: 'Starred contacts can call you.' },
    ]);
    expect(rows.find((r) => r.channel === 'calls')?.status).toBe('enforced');
  });

  it('never assumes success when the device said nothing', () => {
    const resolved = resolvePriority('sleep', [pref({ channel: 'calls', subject: 'Mom' })]);
    const rows = describeEnforcement(resolved, null);
    expect(rows.find((r) => r.channel === 'calls')?.status).toBe('failed');
  });

  it('degrades a silent whatsapp to preference_only, never to failed', () => {
    const resolved = resolvePriority('sleep', [
      pref({ channel: 'whatsapp', subject: 'Family Group', enforceable: false }),
    ]);
    const rows = describeEnforcement(resolved, null);
    expect(rows.find((r) => r.channel === 'whatsapp')?.status).toBe('preference_only');
  });

  it('calls an unconfigured ENFORCEABLE channel unsupported rather than failed', () => {
    const resolved = resolvePriority('sleep', []);
    const rows = describeEnforcement(resolved, null);
    expect(rows.find((r) => r.channel === 'calls')?.status).toBe('unsupported');
    expect(rows.find((r) => r.channel === 'sms')?.status).toBe('unsupported');
  });

  /**
   * WhatsApp being unenforceable is a property of the platform, not of the user's list.
   * Reporting it as `unsupported` when empty reads as "your phone cannot do this", which is
   * a different and wrong claim — it was showing "Not supported on this device" on screen.
   */
  it('reports whatsapp as preference_only even with nothing configured', () => {
    const resolved = resolvePriority('sleep', []);
    const rows = describeEnforcement(resolved, null);
    expect(rows.find((r) => r.channel === 'whatsapp')?.status).toBe('preference_only');
  });
});
