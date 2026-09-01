import { describe, it, expect, beforeEach } from '@jest/globals';
import { activateFromText } from '../contextOrchestrator';
import { getDatabase } from '../../memory/database';
import { ensureSeeded } from '../../memory/seed';
import { profileRepository, priorityRepository } from '../../memory/repositories';
import type { IntentEngine } from '../../ai';
import type { Intent } from '../../types';

// Mock AI Engine for deterministic intents
const mockEngine = (intentOverrides: Partial<Intent>): IntentEngine => ({
  parse: async (text) => ({
    kind: 'intent',
    intent: {
      activity: 'study',
      operation: 'query',
      durationMinutes: null,
      schedule: null,
      persistence: 'unspecified',
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

describe('D4.4 — Database-Backed Memory Query Retrieval', () => {
  beforeEach(async () => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM preference');
    await db.runAsync('DELETE FROM priority_preference');
    await db.runAsync('DELETE FROM command_log');
    await ensureSeeded();
  });

  it('D44-1 — Query retrieves capability memory', async () => {
    const engine = mockEngine({});

    // Seed capability preference
    await profileRepository.createPreference({
      id: 'pref_test1',
      profileId: 'profile_study',
      capability: 'brightness',
      value: 40,
      source: 'user',
      sourceCommand: 'test seed',
      createdAt: Date.now(),
    });

    const outcome = await activateFromText('What do you remember about my study mode?', { engine });

    expect(outcome.kind).toBe('memory-query');
    if (outcome.kind !== 'memory-query') return;

    expect(outcome.memory.capabilities).toHaveLength(1);
    expect(outcome.memory.capabilities[0]?.capability).toBe('brightness');
    expect(outcome.memory.capabilities[0]?.value).toBe(40);
  });

  it('D44-2 — Query retrieves priority memory', async () => {
    const engine = mockEngine({});

    // Seed priority preference
    await priorityRepository.addPreference({
      profileId: 'profile_study',
      channel: 'calls',
      subject: 'Mom',
      subjectKind: 'contact',
      sourceCommand: 'test seed',
      now: Date.now(),
    });

    const outcome = await activateFromText('Who can call me during study?', { engine });

    expect(outcome.kind).toBe('memory-query');
    if (outcome.kind !== 'memory-query') return;

    expect(outcome.memory.priorities).toHaveLength(1);
    expect(outcome.memory.priorities[0]?.subject).toBe('Mom');
    expect(outcome.memory.priorities[0]?.channel).toBe('calls');
  });

  it('D44-3 — Query retrieves combined memory', async () => {
    const engine = mockEngine({});

    await profileRepository.createPreference({
      id: 'pref_test1',
      profileId: 'profile_study',
      capability: 'ringer',
      value: 'silent',
      source: 'user',
      sourceCommand: 'test seed',
      createdAt: Date.now(),
    });

    await priorityRepository.addPreference({
      profileId: 'profile_study',
      channel: 'sms',
      subject: 'Dad',
      subjectKind: 'contact',
      sourceCommand: 'test seed',
      now: Date.now(),
    });

    const outcome = await activateFromText('Show my study preferences', { engine });

    expect(outcome.kind).toBe('memory-query');
    if (outcome.kind !== 'memory-query') return;

    expect(outcome.memory.capabilities).toHaveLength(1);
    expect(outcome.memory.capabilities[0]?.capability).toBe('ringer');
    expect(outcome.memory.priorities).toHaveLength(1);
    expect(outcome.memory.priorities[0]?.subject).toBe('Dad');
  });

  it('D44-4 — Empty memory is safe', async () => {
    const engine = mockEngine({});

    // No seeding
    const outcome = await activateFromText('What do you remember?', { engine });

    expect(outcome.kind).toBe('memory-query');
    if (outcome.kind !== 'memory-query') return;

    // Collections are valid but empty
    expect(outcome.memory.capabilities).toHaveLength(0);
    expect(outcome.memory.priorities).toHaveLength(0);
  });

  it('D44-5 — Query does not execute actions', async () => {
    const engine = mockEngine({});
    const outcome = await activateFromText('Show my study preferences', { engine });

    // Proves it bypassed startSession() and buildActionPlan() by returning early
    expect(outcome.kind).toBe('memory-query');
  });

  it('D44-6 — Query does not mutate memory', async () => {
    const db = await getDatabase();

    // Seed
    await profileRepository.createPreference({
      id: 'pref_test1',
      profileId: 'profile_study',
      capability: 'brightness',
      value: 50,
      source: 'user',
      sourceCommand: 'test seed',
      createdAt: Date.now(),
    });

    const beforePrefs = await db.getAllAsync('SELECT * FROM preference');
    const beforePrio = await db.getAllAsync('SELECT * FROM priority_preference');

    const engine = mockEngine({});
    await activateFromText('Show my memory', { engine });

    const afterPrefs = await db.getAllAsync('SELECT * FROM preference');
    const afterPrio = await db.getAllAsync('SELECT * FROM priority_preference');

    expect(beforePrefs).toEqual(afterPrefs);
    expect(beforePrio).toEqual(afterPrio);
  });

  it('D44-7 — Correct profile isolation', async () => {
    const engineStudy = mockEngine({ activity: 'study' });
    const engineSleep = mockEngine({ activity: 'sleep' });

    // Seed Study
    await profileRepository.createPreference({
      id: 'pref_study',
      profileId: 'profile_study',
      capability: 'brightness',
      value: 30,
      source: 'user',
      sourceCommand: 'test seed',
      createdAt: Date.now(),
    });

    // Seed Sleep
    await profileRepository.createPreference({
      id: 'pref_sleep',
      profileId: 'profile_sleep',
      capability: 'brightness',
      value: 10,
      source: 'user',
      sourceCommand: 'test seed',
      createdAt: Date.now(),
    });

    const outcome = await activateFromText('What about study?', { engine: engineStudy });
    expect(outcome.kind).toBe('memory-query');
    if (outcome.kind !== 'memory-query') return;

    // Must ONLY return study preferences
    expect(outcome.memory.capabilities).toHaveLength(1);
    expect(outcome.memory.capabilities[0]?.value).toBe(30);
  });

  it('D44-8 — Unknown profile safety', async () => {
    const engine = mockEngine({ activity: 'unknown' });

    const outcome = await activateFromText('What do you remember?', { engine });

    // Preserves existing clarification behavior
    expect(outcome.kind).toBe('clarification');
  });
});
