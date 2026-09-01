import { describe, it, expect, beforeEach } from '@jest/globals';
import { activateFromText } from '../contextOrchestrator';
import { profileRepository, priorityRepository } from '../../memory/repositories';
import { getDatabase } from '../../memory/database';
import { ensureSeeded } from '../../memory/seed';
import type { IntentEngine } from '../../ai';
import type { Intent } from '../../types';

// Mock AI Engine for deterministic intents
const mockEngine = (intentOverrides: Partial<Intent>): IntentEngine => ({
  parse: async (text) => ({
    kind: 'intent',
    intent: {
      activity: 'study',
      operation: 'teach',
      durationMinutes: null,
      schedule: null,
      persistence: 'persistent',
      requestedChanges: [],
      exceptions: [],
      rawText: text,
      source: 'fallback',
      confidence: 1.0,
      requiresConfirmation: false,
      ...intentOverrides,
    },
  }),
});

describe('D4.2 — Teaching Persistence Routing', () => {
  beforeEach(async () => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM preference');
    await db.runAsync('DELETE FROM priority_preference');
    await db.runAsync('DELETE FROM command_log');
    await ensureSeeded();
  });

  it('D42-1 — Capability teaching persistence', async () => {
    const engine = mockEngine({
      requestedChanges: [{ capability: 'brightness', value: 40 }],
    });

    const outcome = await activateFromText('Always keep brightness at 40 during study', { engine });

    expect(outcome.kind).toBe('taught');
    if (outcome.kind !== 'taught') return;

    expect(outcome.intent.operation).toBe('teach');

    const prefs = await profileRepository.getPreferencesByProfile(outcome.profile.id);
    expect(prefs).toHaveLength(1);
    expect(prefs[0]?.capability).toBe('brightness');
    expect(prefs[0]?.value).toBe(40);
    expect(prefs[0]?.sourceCommand).toBe('Always keep brightness at 40 during study');
    expect(prefs[0]?.source).toBe('user');
  });

  it('D42-2 — Teaching does not execute device actions', async () => {
    const engine = mockEngine({
      requestedChanges: [{ capability: 'ringer', value: 'silent' }],
    });

    const outcome = await activateFromText('Always keep silent during study', { engine });

    // Crucial check: it did not return 'activated', which means it did NOT generate an ActionPlan.
    expect(outcome.kind).toBe('taught');

    // Command is logged
    const db = await getDatabase();
    const logs = await db.getAllAsync<{ id: string }>('SELECT id FROM command_log');
    expect(logs.length).toBeGreaterThan(0);
  });

  it('D42-3 — Multiple requested changes', async () => {
    const engine = mockEngine({
      requestedChanges: [
        { capability: 'brightness', value: 30 },
        { capability: 'ringer', value: 'vibrate' },
      ],
    });

    const outcome = await activateFromText('Set brightness to 30 and vibrate', { engine });

    expect(outcome.kind).toBe('taught');
    if (outcome.kind !== 'taught') return;

    const prefs = await profileRepository.getPreferencesByProfile(outcome.profile.id);
    expect(prefs).toHaveLength(2);
    expect(prefs.map(p => p.capability).sort()).toEqual(['brightness', 'ringer']);
  });

  it('D42-4 — Last-write-wins through real orchestrator flow', async () => {
    const engine1 = mockEngine({
      requestedChanges: [{ capability: 'brightness', value: 40 }],
    });

    const outcome1 = await activateFromText('Keep brightness at 40', { engine: engine1 });
    expect(outcome1.kind).toBe('taught');
    if (outcome1.kind !== 'taught') return;

    // Second teach overrides the first
    const engine2 = mockEngine({
      requestedChanges: [{ capability: 'brightness', value: 20 }],
    });

    const outcome2 = await activateFromText('Actually, keep brightness at 20', { engine: engine2, now: Date.now() + 1000 });
    expect(outcome2.kind).toBe('taught');

    const prefs = await profileRepository.getPreferencesByProfile(outcome1.profile.id);

    // D4.1 handles duplicate deletion, so only 1 preference should remain
    expect(prefs).toHaveLength(1);
    expect(prefs[0]?.value).toBe(20);
    expect(prefs[0]?.sourceCommand).toBe('Actually, keep brightness at 20');
  });

  it('D42-5 — Positive exception persistence', async () => {
    const engine = mockEngine({
      exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'allow', durationMinutes: null }],
    });

    const outcome = await activateFromText('Let Mom call me', { engine });

    expect(outcome.kind).toBe('taught');
    if (outcome.kind !== 'taught') return;

    const priorities = await priorityRepository.listForProfile(outcome.profile.id);
    expect(priorities).toHaveLength(1);
    expect(priorities[0]?.subject).toBe('Mom');
    expect(priorities[0]?.channel).toBe('calls');
    expect(priorities[0]?.sourceCommand).toBe('Let Mom call me');
  });

  it('D42-6 — Block/correction is NOT implemented as D4.2', async () => {
    const engine = mockEngine({
      exceptions: [{ type: 'contact', value: 'Bob', channel: 'sms', effect: 'block', durationMinutes: null }],
    });

    const outcome = await activateFromText('Do not let Bob text me', { engine });

    expect(outcome.kind).toBe('taught');
    if (outcome.kind !== 'taught') return;

    const priorities = await priorityRepository.listForProfile(outcome.profile.id);
    // Should NOT be added because we only persist effect === 'allow' in D4.2
    expect(priorities).toHaveLength(0);
  });

  it('D42-7 — Profile resolution failure safety', async () => {
    const engine = mockEngine({
      activity: 'unknown',
    });

    const outcome = await activateFromText('Remember this preference', { engine });

    // Preserves existing clarification behavior
    expect(outcome.kind).toBe('clarification');

    // No preferences created
    const db = await getDatabase();
    const prefsCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM preference');
    expect(prefsCount?.c).toBe(0);
  });

  it('D42-8 — Command logging remains singular', async () => {
    const engine = mockEngine({
      requestedChanges: [{ capability: 'brightness', value: 40 }],
    });

    await activateFromText('Log this command once', { engine });

    const db = await getDatabase();
    const logs = await db.getAllAsync<{ id: string }>('SELECT id FROM command_log WHERE rawText = ?', ['Log this command once']);

    // Exactly 1 log entry
    expect(logs).toHaveLength(1);
  });

  describe('D4.3 — Correction & Removal Routing', () => {
    it('D43-1 — Positive preference can be removed', async () => {
      const allowEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'allow', durationMinutes: null }],
      });
      const o1 = await activateFromText('Let Mom call me', { engine: allowEngine });
      expect(o1.kind).toBe('taught');
      if (o1.kind !== 'taught') return;

      let priorities = await priorityRepository.listForProfile(o1.profile.id);
      expect(priorities.some((p) => p.subject === 'Mom')).toBe(true);

      const blockEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'block', durationMinutes: null }],
      });
      await activateFromText('Remove Mom', { engine: blockEngine });

      priorities = await priorityRepository.listForProfile(o1.profile.id);
      expect(priorities.some((p) => p.subject === 'Mom')).toBe(false);
    });

    it('D43-2 — Correction does not execute device actions', async () => {
      const blockEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'block', durationMinutes: null }],
      });
      const outcome = await activateFromText('Remove Mom', { engine: blockEngine });

      // Bypasses execution
      expect(outcome.kind).toBe('taught');
    });

    it('D43-3 — Correct natural key isolation', async () => {
      const allowEngine = mockEngine({
        exceptions: [
          { type: 'contact', value: 'Mom', channel: 'calls', effect: 'allow', durationMinutes: null },
          { type: 'contact', value: 'Dad', channel: 'calls', effect: 'allow', durationMinutes: null }
        ],
      });
      const o1 = await activateFromText('Let Mom and Dad call me', { engine: allowEngine });
      if (o1.kind !== 'taught') return;

      const blockEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'block', durationMinutes: null }],
      });
      await activateFromText('Remove Mom', { engine: blockEngine });

      const priorities = await priorityRepository.listForProfile(o1.profile.id);
      expect(priorities.some((p) => p.subject === 'Dad')).toBe(true);
      expect(priorities.some((p) => p.subject === 'Mom')).toBe(false);
    });

    it('D43-4 — Repeated correction safety', async () => {
      const allowEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'allow', durationMinutes: null }],
      });
      const o1 = await activateFromText('Let Mom call me', { engine: allowEngine });
      if (o1.kind !== 'taught') return;

      const blockEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'block', durationMinutes: null }],
      });
      await activateFromText('Remove Mom', { engine: blockEngine });
      await activateFromText('Remove Mom again', { engine: blockEngine }); // Repeated

      const priorities = await priorityRepository.listForProfile(o1.profile.id);
      expect(priorities.some((p) => p.subject === 'Mom')).toBe(false);
    });

    it('D43-5 — Allow after block', async () => {
      const allowEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'allow', durationMinutes: null }],
      });
      const blockEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'block', durationMinutes: null }],
      });

      const o1 = await activateFromText('Let Mom call me', { engine: allowEngine });
      if (o1.kind !== 'taught') return;
      await activateFromText('Remove Mom', { engine: blockEngine });
      await activateFromText('Let Mom call me again', { engine: allowEngine });

      const priorities = await priorityRepository.listForProfile(o1.profile.id);
      expect(priorities.some((p) => p.subject === 'Mom')).toBe(true);
    });

    it('D43-6 — Block does not create contradictory memory', async () => {
      const blockEngine = mockEngine({
        exceptions: [{ type: 'contact', value: 'Bob', channel: 'sms', effect: 'block', durationMinutes: null }],
      });
      const o1 = await activateFromText('Do not let Bob text me', { engine: blockEngine });
      if (o1.kind !== 'taught') return;

      const priorities = await priorityRepository.listForProfile(o1.profile.id);
      expect(priorities).toHaveLength(0); // Physically deleted, no negative record stored
    });

    it('D43-7 — Temporary behavior remains untouched', async () => {
      const tempEngine = mockEngine({
        operation: 'modify',
        persistence: 'temporary', // explicitly temporary
        exceptions: [{ type: 'contact', value: 'Mom', channel: 'calls', effect: 'allow', durationMinutes: null }],
      });
      const outcome = await activateFromText('During this study session, let Mom call', { engine: tempEngine });

      // Should NOT be intercepted by persistent routing
      expect(outcome.kind).toBe('activated');
    });
  });
});
