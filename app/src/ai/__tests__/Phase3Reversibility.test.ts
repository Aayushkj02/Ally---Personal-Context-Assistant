/**
 * OWNER: SHLOK — Phase 3 Reversibility
 *
 * Phase Goal (SHLOK_REMAINING_PHASES_TASKS.md §PHASE 3):
 *   When Ally temporarily changes device state, the phone returns to exactly
 *   the state it had before the context started.
 *
 * AI responsibility: correctly represent start, duration, end, undo, and
 * temporary-change semantics in the Intent contract.
 *
 * Covers:
 *   S3.1 — Duration understanding
 *   S3.2 — End / Stop commands
 *   S3.3 — Undo
 *   S3.4 — Temporary vs persistent
 *   S3.5 — Tests (this file)
 *
 * Invariants:
 *   - No src/native, src/actions, src/memory, src/policy code is imported.
 *   - The Intent shape is not modified; only producer-side logic is exercised.
 */

import { describe, it, expect } from '@jest/globals';
import { FallbackParser } from '../parsers/FallbackParser';
import { IntentValidator } from '../validators/IntentValidator';
import type { Intent } from '../../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parser = new FallbackParser();

async function parseAndValidate(text: string, ctx?: { activeActivity?: 'study' | 'sleep' }) {
  const raw = await parser.parse(text, ctx);
  return IntentValidator.validate(raw);
}

// ─── S3.1: Duration Understanding ────────────────────────────────────────────

describe('S3.1 — Duration understanding', () => {
  it('numeric hours: "2 hours" → durationMinutes=120', async () => {
    const r = await parseAndValidate('I am going to study for 2 hours.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBe(120);
  });

  it('word-form hours: "two hours" → durationMinutes=120', async () => {
    const r = await parseAndValidate("I'm going to study for two hours.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBe(120);
  });

  it('numeric minutes: "45 minutes" → durationMinutes=45', async () => {
    const r = await parseAndValidate('Focus for 45 minutes.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBe(45);
  });

  it('"45 mins" shorthand → durationMinutes=45', async () => {
    const r = await parseAndValidate('Study for 45 mins.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBe(45);
  });

  it('numeric minutes: "30 minutes" → durationMinutes=30', async () => {
    const r = await parseAndValidate('Keep this mode on for 30 minutes.', {
      activeActivity: 'study',
    });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBe(30);
  });

  it('word-form minutes: "thirty minutes" → durationMinutes=30', async () => {
    const r = await parseAndValidate('Study for thirty minutes.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBe(30);
  });

  it('decimal hours: "1.5 hours" → durationMinutes=90', async () => {
    const r = await parseAndValidate('Study for 1.5 hours.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBe(90);
  });

  it('missing duration → durationMinutes=null (must not invent)', async () => {
    // S3.1 rule: do not invent a duration when the user did not provide one
    const r = await parseAndValidate("I'm done studying.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBeNull();
  });

  it('plain "study" with no duration → durationMinutes=null', async () => {
    const r = await parseAndValidate("I'm going to study.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBeNull();
  });

  it('exception command with no duration → durationMinutes=null', async () => {
    const r = await parseAndValidate('Let Mom call me while I study.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBeNull();
  });

  it('durationMinutes is always a positive integer or null, never 0 or negative', async () => {
    const commands = [
      "I'm going to study for two hours.",
      'Study for 45 minutes.',
      "I'm going to study.",
      "I'm done studying.",
    ];
    for (const text of commands) {
      const r = await parseAndValidate(text);
      if (r.kind !== 'intent') continue;
      if (r.intent.durationMinutes !== null) {
        expect(r.intent.durationMinutes).toBeGreaterThan(0);
        expect(Number.isInteger(r.intent.durationMinutes)).toBe(true);
      }
    }
  });
});

// ─── S3.2: End / Stop Commands ───────────────────────────────────────────────

describe('S3.2 — End / stop commands', () => {
  it('"I\'m done studying." → deactivate, study', async () => {
    const r = await parseAndValidate("I'm done studying.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Stop study mode." → deactivate, study', async () => {
    const r = await parseAndValidate('Stop study mode.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Finished studying." → deactivate, study', async () => {
    const r = await parseAndValidate('Finished studying.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Done studying." → deactivate, study', async () => {
    const r = await parseAndValidate('Done studying.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"End study session." → deactivate, study', async () => {
    const r = await parseAndValidate('End study session.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"End this session." (with active context) → deactivate', async () => {
    const r = await parseAndValidate('End this session.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Turn off this mode." (with active context) → deactivate', async () => {
    const r = await parseAndValidate('Turn off this mode.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Deactivate study mode." → deactivate (no substring collision with activate)', async () => {
    // Regression: "deactivate" must not match the "activate" branch first
    const r = await parseAndValidate('Deactivate study mode.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Stop studying." → deactivate, study', async () => {
    const r = await parseAndValidate('Stop studying.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('end command produces no durationMinutes (not invented)', async () => {
    const r = await parseAndValidate("I'm done studying.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBeNull();
  });
});

// ─── S3.3: Undo ──────────────────────────────────────────────────────────────

describe('S3.3 — Undo', () => {
  it('"Undo that." (with active study context) → deactivate, study', async () => {
    const r = await parseAndValidate('Undo that.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Undo that." (with active sleep context) → deactivate, sleep', async () => {
    const r = await parseAndValidate('Undo that.', { activeActivity: 'sleep' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Undo the last change." (with active context) → deactivate', async () => {
    const r = await parseAndValidate('Undo the last change.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.operation).toBe('deactivate');
  });

  it('"Restore my previous settings." (with active context) → deactivate', async () => {
    const r = await parseAndValidate('Restore my previous settings.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.operation).toBe('deactivate');
  });

  it('undo intent contains no requestedChanges — AI does not decide restoration values', async () => {
    // S3.3: "AI expresses the reversal request. The AI does not decide which device values to restore."
    const r = await parseAndValidate('Undo that.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.requestedChanges).toHaveLength(0);
  });

  it('undo intent has durationMinutes=null (no invented duration)', async () => {
    const r = await parseAndValidate('Undo that.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.durationMinutes).toBeNull();
  });
});

// ─── S3.4: Temporary vs Persistent ───────────────────────────────────────────

describe('S3.4 — Temporary vs persistent preferences', () => {
  it('"During this study session, let Mom call me." → persistence=temporary', async () => {
    const r = await parseAndValidate('During this study session, let Mom call me.', {
      activeActivity: 'study',
    });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.persistence).toBe('temporary');
  });

  it('"Always let Mom call me during study." → persistence=persistent', async () => {
    const r = await parseAndValidate('Always let Mom call me during study.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.persistence).toBe('persistent');
  });

  it('temporary !== persistent — they must not be the same value', async () => {
    const temp = await parseAndValidate('During this study session, let Mom call me.', {
      activeActivity: 'study',
    });
    const perm = await parseAndValidate('Always let Mom call me during study.');
    expect(temp.kind).toBe('intent');
    expect(perm.kind).toBe('intent');
    if (temp.kind !== 'intent' || perm.kind !== 'intent') return;
    expect(temp.intent.persistence).toBe('temporary');
    expect(perm.intent.persistence).toBe('persistent');
    expect(temp.intent.persistence).not.toBe(perm.intent.persistence);
  });

  it('"while I study" scoping → persistence=temporary', async () => {
    const r = await parseAndValidate('Let Mom call me while I study.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.persistence).toBe('temporary');
  });

  it('"whenever I study" → persistence=persistent (profile-level)', async () => {
    const r = await parseAndValidate('Whenever I study, let Mom call me.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.persistence).toBe('persistent');
  });

  it('"for now" → persistence=temporary', async () => {
    const r = await parseAndValidate('For now, let Mom call me.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.persistence).toBe('temporary');
  });

  it('"every time I study" → persistence=persistent', async () => {
    const r = await parseAndValidate('Every time I study, let Mom call me.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.persistence).toBe('persistent');
  });

  it('no persistence signal → persistence=unspecified (not invented)', async () => {
    // The parser must not invent a persistence value when no signal is present
    const r = await parseAndValidate("I'm going to study for two hours.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.persistence).toBe('unspecified');
  });

  it('persistence value is always a valid PERSISTENCE member', async () => {
    const VALID = ['session', 'temporary', 'persistent', 'unspecified'] as const;
    const commands = [
      'During this study session, let Mom call me.',
      'Always let Mom call me during study.',
      "I'm going to study for two hours.",
      'Let Mom call me while I study.',
    ];
    for (const text of commands) {
      const r = await parseAndValidate(text, { activeActivity: 'study' });
      if (r.kind !== 'intent') continue;
      expect(VALID as readonly string[]).toContain(r.intent.persistence);
    }
  });
});

// ─── S3.5: Malformed / Ambiguous Input ───────────────────────────────────────

describe('S3.5 — Malformed AI output and ambiguous input', () => {
  it('malformed AI output with low confidence → validator produces clarification', async () => {
    const malformed = {
      kind: 'intent' as const,
      intent: {
        activity: 'study' as const,
        operation: 'activate' as const,
        durationMinutes: null,
        schedule: null,
        persistence: 'unspecified' as const,
        requestedChanges: [],
        exceptions: [],
        confidence: 0.2, // below CONFIDENCE_THRESHOLD (0.7)
        requiresConfirmation: true,
        rawText: "I'm going to study",
        source: 'ollama' as const,
      },
    };
    const result = IntentValidator.validate(malformed);
    expect(result.kind).toBe('clarification');
  });

  it('malformed AI output with unsupported capability → validator rejects', async () => {
    const unsupported = {
      kind: 'intent' as const,
      intent: {
        activity: 'study' as const,
        operation: 'activate' as const,
        durationMinutes: 120,
        schedule: null,
        persistence: 'unspecified' as const,
        requestedChanges: [{ capability: 'wifi' as never, value: 'off' }],
        exceptions: [],
        confidence: 0.9,
        requiresConfirmation: false,
        rawText: 'Study for 2 hours, turn off wifi',
        source: 'ollama' as const,
      },
    };
    const result = IntentValidator.validate(unsupported);
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.question).toContain('cannot manage');
    }
  });

  it('empty text → clarification, not crash', async () => {
    const r = await parseAndValidate('');
    expect(r.kind).toBe('clarification');
  });

  it('ambiguous "change the setting" (no activity, no ctx) → clarification', async () => {
    const r = await parseAndValidate('Change the setting.');
    expect(r.kind).toBe('clarification');
  });

  it('ambiguous "let them through" (no activity, no ctx) → clarification', async () => {
    const r = await parseAndValidate('Let them through.');
    expect(r.kind).toBe('clarification');
  });

  it('unsupported capability wifi not added to requestedChanges', async () => {
    // "turn on wifi" is not a supported capability
    const r = await parseAndValidate('Turn on wifi during study.');
    if (r.kind === 'intent') {
      const hasWifi = r.intent.requestedChanges.some((c) => (c.capability as string) === 'wifi');
      expect(hasWifi).toBe(false);
    }
    // clarification is also acceptable
  });

  it('rawText is always the verbatim user input (memory provenance)', async () => {
    const input = "I'm going to study for two hours.";
    const r = await parseAndValidate(input);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.rawText).toBe(input);
  });

  it('all intent fields satisfy the frozen contract across a representative command set', async () => {
    const VALID_ACTIVITIES = ['study', 'sleep', 'unknown'] as const;
    const VALID_OPERATIONS = ['activate', 'deactivate', 'teach', 'modify', 'query'] as const;
    const VALID_PERSISTENCE = ['session', 'temporary', 'persistent', 'unspecified'] as const;

    const cases: Array<{ text: string; ctx?: { activeActivity?: 'study' | 'sleep' } }> = [
      { text: "I'm going to study for two hours." },
      { text: "I'm done studying." },
      { text: 'Undo that.', ctx: { activeActivity: 'study' } },
      { text: 'During this study session, let Mom call me.', ctx: { activeActivity: 'study' } },
      { text: 'Always let Mom call me during study.' },
    ];

    for (const { text, ctx } of cases) {
      const r = await parseAndValidate(text, ctx);
      if (r.kind !== 'intent') continue;
      const i: Intent = r.intent;
      expect(VALID_ACTIVITIES as readonly string[]).toContain(i.activity);
      expect(VALID_OPERATIONS as readonly string[]).toContain(i.operation);
      expect(VALID_PERSISTENCE as readonly string[]).toContain(i.persistence);
      expect(typeof i.confidence).toBe('number');
      expect(i.confidence).toBeGreaterThanOrEqual(0);
      expect(i.confidence).toBeLessThanOrEqual(1);
      expect(typeof i.requiresConfirmation).toBe('boolean');
      expect(typeof i.rawText).toBe('string');
      expect(['ollama', 'fallback']).toContain(i.source);
    }
  });
});
