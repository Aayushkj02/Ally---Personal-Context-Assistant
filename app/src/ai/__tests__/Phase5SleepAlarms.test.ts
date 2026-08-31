/**
 * OWNER: SHLOK — Phase 5 Sleep & Entry Points
 *
 * Phase Goal (SHLOK_REMAINING_PHASES_TASKS.md §PHASE 5):
 *   The product gate includes a real alarm in the stock Clock app.
 *   AI responsibility: correct interpretation of sleep/entry-point commands,
 *   wake-up times, weekday recurrence, alarm modifications, and cancellations.
 *
 * Covers:
 *   S5.1 — Sleep Intent
 *   S5.2 — Wake-Up Time Extraction
 *   S5.3 — Sleep + Alarm Combined Requests
 *   S5.4 — Alarm Changes & Cancellation
 *   S5.5 — Sleep Edge Cases & Tests
 *
 * Invariants:
 *   - No src/native, src/actions, src/memory, src/policy code is imported.
 *   - AI expresses intent only; Aayush's native layer creates the Android alarm.
 */

import { describe, it, expect } from '@jest/globals';
import { FallbackParser } from '../parsers/FallbackParser';
import { IntentValidator } from '../validators/IntentValidator';

const parser = new FallbackParser();

async function parseAndValidate(text: string, ctx?: { activeActivity?: 'study' | 'sleep' }) {
  const raw = await parser.parse(text, ctx);
  return IntentValidator.validate(raw);
}

// ─── S5.1: Sleep Intent ──────────────────────────────────────────────────────

describe('S5.1 — Sleep intent entry points', () => {
  it('"I\'m going to sleep." → activity=sleep, operation=activate', async () => {
    const r = await parseAndValidate("I'm going to sleep.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('activate');
    expect(r.intent.schedule).toBeNull();
  });

  it('"Start sleep mode." → activity=sleep, operation=activate', async () => {
    const r = await parseAndValidate('Start sleep mode.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('activate');
  });

  it('"I\'m sleeping now." → activity=sleep, operation=activate', async () => {
    const r = await parseAndValidate("I'm sleeping now.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('activate');
  });

  it('"Going to bed." → activity=sleep, operation=activate', async () => {
    const r = await parseAndValidate('Going to bed.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('activate');
  });

  it('"I\'m off to bed." → activity=sleep, operation=activate', async () => {
    const r = await parseAndValidate("I'm off to bed.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('activate');
  });
});

// ─── S5.2: Wake-Up Time Extraction ───────────────────────────────────────────

describe('S5.2 — Wake-up time extraction & recurrence', () => {
  it('"Wake me at 7 AM." → time=07:00, kind=once (no recurrence invented)', async () => {
    const r = await parseAndValidate('Wake me at 7 AM.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.schedule).toEqual({
      kind: 'once',
      time: '07:00',
    });
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '07:00',
    });
  });

  it('"Wake me at 6:30 tomorrow." → time=06:30, kind=once', async () => {
    const r = await parseAndValidate('Wake me at 6:30 tomorrow.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.schedule).toEqual({
      kind: 'once',
      time: '06:30',
    });
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '06:30',
    });
  });

  it('"Wake me at 7 AM on weekdays." → time=07:00, kind=weekdays', async () => {
    const r = await parseAndValidate('Wake me at 7 AM on weekdays.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.schedule).toEqual({
      kind: 'weekdays',
      time: '07:00',
    });
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '07:00',
    });
  });

  it('recurrence is never invented when not stated ("wake at 7" → once)', async () => {
    const r = await parseAndValidate('Wake me at 7 AM.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.schedule?.kind).toBe('once');
    expect(r.intent.schedule?.kind).not.toBe('weekdays');
  });
});

// ─── S5.3: Sleep + Alarm Combined Requests ───────────────────────────────────

describe('S5.3 — Combined sleep context and alarm requests', () => {
  it('"I\'m going to sleep. Wake me at 7 AM on weekdays." → sleep context + weekdays alarm', async () => {
    const r = await parseAndValidate("I'm going to sleep. Wake me at 7 AM on weekdays.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('activate');
    expect(r.intent.schedule).toEqual({
      kind: 'weekdays',
      time: '07:00',
    });
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '07:00',
    });
  });

  it('"Going to bed. Set alarm for 6:30 AM on weekdays." → sleep + 06:30 weekdays alarm', async () => {
    const r = await parseAndValidate('Going to bed. Set alarm for 6:30 AM on weekdays.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.schedule).toEqual({
      kind: 'weekdays',
      time: '06:30',
    });
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '06:30',
    });
  });
});

// ─── S5.4: Alarm Changes & Cancellation ─────────────────────────────────────

describe('S5.4 — Alarm modification and cancellation', () => {
  it('"Change my wake-up time to 7:30." → modify, alarm=07:30', async () => {
    const r = await parseAndValidate('Change my wake-up time to 7:30.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('modify');
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '07:30',
    });
  });

  it('"Move tomorrow\'s alarm to 8." → modify, alarm=08:00', async () => {
    const r = await parseAndValidate("Move tomorrow's alarm to 8.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('modify');
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '08:00',
    });
  });

  it('"Cancel the wake-up alarm." → modify, schedule kind=none', async () => {
    const r = await parseAndValidate('Cancel the wake-up alarm.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('modify');
    expect(r.intent.schedule).toEqual({
      kind: 'none',
      time: null,
    });
    // No active alarm capability value added
    expect(r.intent.requestedChanges.some((c) => c.capability === 'alarm')).toBe(false);
  });

  it('"Turn off alarm." → modify, schedule kind=none', async () => {
    const r = await parseAndValidate('Turn off alarm.', { activeActivity: 'sleep' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('modify');
    expect(r.intent.schedule).toEqual({
      kind: 'none',
      time: null,
    });
  });
});

// ─── S5.5: Sleep Edge Cases & Safety ─────────────────────────────────────────

describe('S5.5 — Sleep edge cases, invalid input, and safety', () => {
  it('sleep command with no time → schedule=null (no fake alarm created)', async () => {
    const r = await parseAndValidate("I'm going to sleep.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.schedule).toBeNull();
    expect(r.intent.requestedChanges.some((c) => c.capability === 'alarm')).toBe(false);
  });

  it('sleep mode with parents exception and wake-up alarm', async () => {
    const r = await parseAndValidate('When I sleep, let Mom call me and wake me at 7 AM.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    const exc = r.intent.exceptions.find((e) => e.value === 'Mom');
    expect(exc).toBeDefined();
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'alarm',
      value: '07:00',
    });
  });

  it('invalid schedule time string rejected safely by IntentValidator', async () => {
    const invalidResult = {
      kind: 'intent' as const,
      intent: {
        activity: 'sleep' as const,
        operation: 'activate' as const,
        durationMinutes: null,
        schedule: { kind: 'once' as const, time: '25:99' },
        persistence: 'unspecified' as const,
        requestedChanges: [],
        exceptions: [],
        confidence: 0.9,
        requiresConfirmation: false,
        rawText: 'Wake me at 25:99',
        source: 'ollama' as const,
      },
    };
    const validated = IntentValidator.validate(invalidResult);
    expect(validated.kind).toBe('clarification');
  });

  it('all alarm times adhere to HH:MM 24-hour format in capability domain', async () => {
    const testPhrases = [
      'Wake me at 7 AM.',
      'Wake me at 6:30 tomorrow.',
      'Wake me at 7 AM on weekdays.',
      'Change my wake-up time to 7:30.',
      "Move tomorrow's alarm to 8.",
    ];

    for (const phrase of testPhrases) {
      const r = await parseAndValidate(phrase);
      expect(r.kind).toBe('intent');
      if (r.kind !== 'intent') continue;

      const alarmChange = r.intent.requestedChanges.find((c) => c.capability === 'alarm');
      if (alarmChange) {
        expect(typeof alarmChange.value).toBe('string');
        expect(IntentValidator.isValidTime(alarmChange.value as string)).toBe(true);
      }
    }
  });
});
