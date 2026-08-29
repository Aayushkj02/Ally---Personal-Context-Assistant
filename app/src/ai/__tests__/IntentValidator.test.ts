import { describe, it, expect } from '@jest/globals';
import { IntentValidator } from '../validators/IntentValidator';
import type { Intent, ParseResult } from '../../types';

describe('IntentValidator', () => {
  const validStudyIntent: Intent = {
    activity: 'study',
    operation: 'activate',
    durationMinutes: 120,
    schedule: null,
    persistence: 'session',
    requestedChanges: [
      { capability: 'ringer', value: 'silent' },
      { capability: 'brightness', value: 40 },
    ],
    exceptions: [],
    confidence: 0.9,
    requiresConfirmation: false,
    rawText: 'Study for 2 hours',
    source: 'fallback',
  };

  it('passes validation for a fully valid intent', () => {
    const input: ParseResult = { kind: 'intent', intent: validStudyIntent };
    const result = IntentValidator.validate(input);

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.operation).toBe('activate');
      expect(result.intent.requestedChanges).toHaveLength(2);
    }
  });

  it('rejects an intent with low confidence', () => {
    const lowConfidenceInput: ParseResult = {
      kind: 'intent',
      intent: { ...validStudyIntent, confidence: 0.5 },
    };
    const result = IntentValidator.validate(lowConfidenceInput);

    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.question).toContain('clarify');
    }
  });

  it('rejects an intent with an unknown capability', () => {
    const unknownCapInput: ParseResult = {
      kind: 'intent',
      intent: {
        ...validStudyIntent,
        requestedChanges: [{ capability: 'coffee_maker' as any, value: 'on' }],
      },
    };
    const result = IntentValidator.validate(unknownCapInput);

    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.question).toContain('cannot manage');
    }
  });

  it('rejects out-of-range brightness', () => {
    const invalidBrightnessInput: ParseResult = {
      kind: 'intent',
      intent: {
        ...validStudyIntent,
        requestedChanges: [{ capability: 'brightness', value: 150 }],
      },
    };
    const result = IntentValidator.validate(invalidBrightnessInput);

    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.question).toContain('Invalid setting value');
    }
  });

  it('rejects invalid ringer mode enum value', () => {
    const invalidRingerInput: ParseResult = {
      kind: 'intent',
      intent: {
        ...validStudyIntent,
        requestedChanges: [{ capability: 'ringer', value: 'super_loud' }],
      },
    };
    const result = IntentValidator.validate(invalidRingerInput);

    expect(result.kind).toBe('clarification');
  });

  it('rejects invalid alarm time format', () => {
    const invalidAlarmInput: ParseResult = {
      kind: 'intent',
      intent: {
        ...validStudyIntent,
        requestedChanges: [{ capability: 'alarm', value: '25:99' }],
      },
    };
    const result = IntentValidator.validate(invalidAlarmInput);

    expect(result.kind).toBe('clarification');
  });

  it('rejects unknown activity', () => {
    const unknownActivityInput: ParseResult = {
      kind: 'intent',
      intent: { ...validStudyIntent, activity: 'unknown' },
    };
    const result = IntentValidator.validate(unknownActivityInput);

    expect(result.kind).toBe('clarification');
  });

  it('passes clarification through without modification', () => {
    const clarificationInput: ParseResult = {
      kind: 'clarification',
      question: 'Which mode?',
      options: ['Study', 'Sleep'],
      rawText: 'hello',
    };
    const result = IntentValidator.validate(clarificationInput);

    expect(result).toEqual(clarificationInput);
  });
});
