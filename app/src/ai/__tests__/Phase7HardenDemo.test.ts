/**
 * OWNER: SHLOK — Phase 7 Harden & Demo Reliability
 *
 * Phase Goal (SHLOK_REMAINING_PHASES_TASKS.md §PHASE 7):
 *   Final demo reliability under normal and degraded conditions.
 *
 * Covers:
 *   S7.1 — Golden Command Freeze (9 command families)
 *   S7.2 — Ollama / Network Failure & Silent Fallback
 *   S7.3 — Malformed Model Output Isolation & Validation
 *   S7.4 — Unsupported Request Rejection & WhatsApp Integrity
 *   S7.5 & S7.6 — Complete AI Regression & Repeatable Demo Stability
 *
 * Invariants:
 *   - 100% offline capability verified with no network dependency.
 *   - The frozen Intent contract (src/types/intent.ts) is strictly maintained.
 *   - No fake success or unhandled exceptions under any degraded condition.
 */

import { describe, it, expect } from '@jest/globals';
import { DefaultIntentEngine } from '../index';
import { FallbackParser, OllamaParser } from '../parsers';
import { IntentValidator } from '../validators';
import type { Intent, ParseResult } from '../../types';

const fallbackParser = new FallbackParser();

// ─── S7.1: Golden Command Freeze (9 Command Families) ────────────────────────

describe('S7.1 — Golden Command Freeze (All 9 Core Families)', () => {
  // Family 1: Study
  it('Family 1 (Study): "Start study mode." → study, activate', async () => {
    const raw = await fallbackParser.parse('Start study mode.');
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('activate');
  });

  // Family 2: Sleep
  it('Family 2 (Sleep): "I\'m going to sleep. Wake me at 7 AM." → sleep, activate, alarm=07:00', async () => {
    const raw = await fallbackParser.parse("I'm going to sleep. Wake me at 7 AM.");
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('activate');
    expect(r.intent.schedule).toEqual({ kind: 'once', time: '07:00' });
  });

  // Family 3: Duration
  it('Family 3 (Duration): "I\'m going to study for two hours." → duration=120 (never invented on missing)', async () => {
    const rawWithDuration = await fallbackParser.parse("I'm going to study for two hours.");
    const r1 = IntentValidator.validate(rawWithDuration);
    expect(r1.kind).toBe('intent');
    if (r1.kind === 'intent') {
      expect(r1.intent.durationMinutes).toBe(120);
    }

    const rawNoDuration = await fallbackParser.parse("I'm done studying.");
    const r2 = IntentValidator.validate(rawNoDuration);
    expect(r2.kind).toBe('intent');
    if (r2.kind === 'intent') {
      expect(r2.intent.durationMinutes).toBeNull();
    }
  });

  // Family 4: Priority Calls
  it('Family 4 (Calls): "Let Mom call me while I study." → channel=calls, contact=Mom', async () => {
    const raw = await fallbackParser.parse('Let Mom call me while I study.');
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.exceptions[0]?.channel).toBe('calls');
    expect(r.intent.exceptions[0]?.value).toBe('Mom');
    expect(r.intent.exceptions[0]?.effect).toBe('allow');
  });

  // Family 5: Priority SMS
  it('Family 5 (SMS): "Let Mom\'s SMS through while I study." → channel=sms', async () => {
    const raw = await fallbackParser.parse("Let Mom's SMS through while I study.");
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.exceptions[0]?.channel).toBe('sms');
  });

  // Family 6: WhatsApp Preference
  it('Family 6 (WhatsApp): "Let my project WhatsApp group through while I study." → whatsapp, requiresConfirmation=true', async () => {
    const raw = await fallbackParser.parse('Let my project WhatsApp group through while I study.', {
      activeActivity: 'study',
    });
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.exceptions[0]?.channel).toBe('whatsapp');
    expect(r.intent.requiresConfirmation).toBe(true);
  });

  // Family 7: Undo / End
  it('Family 7 (Undo/End): "Undo that." → deactivate, requestedChanges empty', async () => {
    const raw = await fallbackParser.parse('Undo that.', { activeActivity: 'study' });
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.operation).toBe('deactivate');
    expect(r.intent.requestedChanges).toHaveLength(0);
  });

  // Family 8: Emergency & Memory Queries
  it('Family 8 (Memory Queries): "Why do you let Mom call me during sleep?" → query, sleep', async () => {
    const raw = await fallbackParser.parse('Why do you let Mom call me during sleep?');
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.operation).toBe('query');
    expect(r.intent.activity).toBe('sleep');
  });

  // Family 9: Teaching & Preference Memory
  it('Family 9 (Teaching): "Remember that Mom can call me during sleep." → teach, persistent, verbatim rawText', async () => {
    const cmd = 'Remember that Mom can call me during sleep.';
    const raw = await fallbackParser.parse(cmd);
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;
    expect(r.intent.operation).toBe('teach');
    expect(r.intent.persistence).toBe('persistent');
    expect(r.intent.rawText).toBe(cmd);
  });
});

// ─── S7.2: Ollama / Network Failure & Graceful Degradation ───────────────────

describe('S7.2 — Ollama / Network Failure & Fallback Resilience', () => {
  it('falls through silently to FallbackParser when Ollama is unavailable', async () => {
    const mockUnavailableOllama = {
      name: 'ollama' as const,
      isAvailable: async () => false,
      parse: async () => {
        throw new Error('Should not be called when unavailable');
      },
    } as unknown as OllamaParser;

    const engine = new DefaultIntentEngine(mockUnavailableOllama, fallbackParser);
    const result = await engine.parse("I'm going to study for two hours.");

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.source).toBe('fallback');
      expect(result.intent.activity).toBe('study');
      expect(result.intent.durationMinutes).toBe(120);
    }
  });

  it('falls through silently to FallbackParser when Ollama throws a network error', async () => {
    const mockCrashingOllama = {
      name: 'ollama' as const,
      isAvailable: async () => true,
      parse: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:11434 - Network unreachable');
      },
    } as unknown as OllamaParser;

    const engine = new DefaultIntentEngine(mockCrashingOllama, fallbackParser);
    const result = await engine.parse('Stop study mode.');

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.source).toBe('fallback');
      expect(result.intent.operation).toBe('deactivate');
    }
  });

  it('falls through silently to FallbackParser when Ollama exceeds 2.5s timeout', async () => {
    const mockHangingOllama = {
      name: 'ollama' as const,
      isAvailable: async () => true,
      parse: async () => {
        return new Promise<ParseResult | null>((resolve) => {
          setTimeout(() => {
            resolve({
              kind: 'intent',
              intent: {
                activity: 'study',
                operation: 'activate',
                durationMinutes: 60,
                schedule: null,
                persistence: 'unspecified',
                requestedChanges: [],
                exceptions: [],
                confidence: 0.95,
                requiresConfirmation: false,
                rawText: 'Study for 1 hour.',
                source: 'ollama',
              },
            });
          }, 3500); // Exceeds 2500ms OLLAMA_TIMEOUT_MS
        });
      },
    } as unknown as OllamaParser;

    const engine = new DefaultIntentEngine(mockHangingOllama, fallbackParser);
    const result = await engine.parse('Study for 1 hour.');

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.source).toBe('fallback');
      expect(result.intent.activity).toBe('study');
      expect(result.intent.durationMinutes).toBe(60);
    }
  }, 10000);
});

// ─── S7.3: Malformed Model Output Isolation ─────────────────────────────────

describe('S7.3 — Malformed Model Output Isolation', () => {
  it('rejects out-of-domain capability value (brightness > 100) → clarification', () => {
    const malformed: ParseResult = {
      kind: 'intent',
      intent: {
        activity: 'study',
        operation: 'modify',
        durationMinutes: null,
        schedule: null,
        persistence: 'unspecified',
        requestedChanges: [{ capability: 'brightness', value: 150 }], // Invalid: domain is 0..100
        exceptions: [],
        confidence: 0.9,
        requiresConfirmation: false,
        rawText: 'Set brightness to 150%',
        source: 'ollama',
      },
    };

    const result = IntentValidator.validate(malformed);
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.question).toContain('Invalid setting value');
    }
  });

  it('rejects unsupported capability (e.g. "bluetooth") → clarification', () => {
    const unsupported: ParseResult = {
      kind: 'intent',
      intent: {
        activity: 'study',
        operation: 'activate',
        durationMinutes: null,
        schedule: null,
        persistence: 'unspecified',
        requestedChanges: [{ capability: 'bluetooth' as never, value: 'on' }],
        exceptions: [],
        confidence: 0.9,
        requiresConfirmation: false,
        rawText: 'Connect bluetooth while I study',
        source: 'ollama',
      },
    };

    const result = IntentValidator.validate(unsupported);
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.question).toContain("Ally cannot manage 'bluetooth'");
    }
  });

  it('rejects invalid schedule time (e.g. "25:70") → clarification', () => {
    const badSchedule: ParseResult = {
      kind: 'intent',
      intent: {
        activity: 'sleep',
        operation: 'activate',
        durationMinutes: null,
        schedule: { kind: 'once', time: '25:70' },
        persistence: 'unspecified',
        requestedChanges: [],
        exceptions: [],
        confidence: 0.95,
        requiresConfirmation: false,
        rawText: 'Wake me at 25:70',
        source: 'ollama',
      },
    };

    const result = IntentValidator.validate(badSchedule);
    expect(result.kind).toBe('clarification');
  });

  it('rejects low confidence output (< 0.7) → clarification', () => {
    const lowConfidence: ParseResult = {
      kind: 'intent',
      intent: {
        activity: 'study',
        operation: 'activate',
        durationMinutes: null,
        schedule: null,
        persistence: 'unspecified',
        requestedChanges: [],
        exceptions: [],
        confidence: 0.4, // Below 0.7 threshold
        requiresConfirmation: false,
        rawText: 'Maybe study perhaps',
        source: 'ollama',
      },
    };

    const result = IntentValidator.validate(lowConfidence);
    expect(result.kind).toBe('clarification');
  });
});

// ─── S7.4: Unsupported Requests & WhatsApp Integrity ─────────────────────────

describe('S7.4 — Unsupported Requests & Channel Integrity', () => {
  it('unsupported appliance request ("Turn on washing machine.") → clarification', async () => {
    const raw = await fallbackParser.parse('Turn on my washing machine.');
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('clarification');
  });

  it('unsupported device request ("Connect to WiFi.") → clarification', async () => {
    const raw = await fallbackParser.parse('Connect to WiFi.');
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('clarification');
  });

  it('WhatsApp is never claimed as enforceable in AI intent output', async () => {
    const raw = await fallbackParser.parse(
      'Allow my project WhatsApp group to notify me while studying.',
    );
    const r = IntentValidator.validate(raw);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    // Intent must mark requiresConfirmation=true and exception channel='whatsapp'
    expect(r.intent.exceptions[0]?.channel).toBe('whatsapp');
    expect(r.intent.requiresConfirmation).toBe(true);
  });
});

// ─── S7.6: Repeatable Demo Stability ─────────────────────────────────────────

describe('S7.6 — Repeatable Demo Stability across Golden Scenarios', () => {
  it('produces identical deterministic results across repeated iterations', async () => {
    const goldenCommands = [
      "I'm going to study for two hours.",
      'Let Mom call me while I study.',
      "Let Mom's SMS through while I study.",
      'Let my project WhatsApp group through while I study.',
      "I'm done studying.",
      'Undo that.',
      "I'm going to sleep. Wake me at 7 AM on weekdays.",
      'Remember that Mom can call me during sleep.',
    ];

    for (const cmd of goldenCommands) {
      const res1 = IntentValidator.validate(await fallbackParser.parse(cmd));
      const res2 = IntentValidator.validate(await fallbackParser.parse(cmd));
      expect(res1).toEqual(res2);
    }
  });
});
