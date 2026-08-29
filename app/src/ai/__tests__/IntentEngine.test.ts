import { describe, it, expect, jest } from '@jest/globals';
import { DefaultIntentEngine } from '../index';
import { FallbackParser, OllamaParser } from '../parsers';
import type { ParseResult } from '../../types';

describe('DefaultIntentEngine', () => {
  it('falls back to FallbackParser when Ollama is unavailable', async () => {
    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
      parse: jest.fn<() => Promise<ParseResult | null>>().mockResolvedValue(null),
    };

    const fallbackParser = new FallbackParser();
    const engine = new DefaultIntentEngine(
      mockOllama as unknown as OllamaParser,
      fallbackParser,
    );

    const result = await engine.parse("I'm going to study for 2 hours.");

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.source).toBe('fallback');
    }
  });

  it('uses Ollama when available and returns valid intent', async () => {
    const validOllamaResult: ParseResult = {
      kind: 'intent',
      intent: {
        activity: 'study',
        operation: 'activate',
        durationMinutes: 120,
        schedule: null,
        persistence: 'session',
        requestedChanges: [{ capability: 'ringer', value: 'silent' }],
        exceptions: [],
        confidence: 0.95,
        requiresConfirmation: false,
        rawText: 'Study for 2 hours',
        source: 'ollama',
      },
    };

    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      parse: jest.fn<() => Promise<ParseResult | null>>().mockResolvedValue(validOllamaResult),
    };

    const fallbackParser = new FallbackParser();
    const engine = new DefaultIntentEngine(
      mockOllama as unknown as OllamaParser,
      fallbackParser,
    );

    const result = await engine.parse("I'm going to study for 2 hours.");

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.source).toBe('ollama');
    }
  });
});
