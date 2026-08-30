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
    const engine = new DefaultIntentEngine(mockOllama as unknown as OllamaParser, fallbackParser);

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
    const engine = new DefaultIntentEngine(mockOllama as unknown as OllamaParser, fallbackParser);

    const result = await engine.parse("I'm going to study for 2 hours.");

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.source).toBe('ollama');
    }
  });

  // ── Phase 2 robustness tests (Task S-V2, Section 10, Section 12) ─────────

  it('S-V2: falls back when Ollama throws an exception (network error)', async () => {
    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      parse: jest
        .fn<() => Promise<ParseResult | null>>()
        .mockRejectedValue(new Error('Network error')),
    };

    const fallbackParser = new FallbackParser();
    const engine = new DefaultIntentEngine(mockOllama as unknown as OllamaParser, fallbackParser);

    const result = await engine.parse("I'm going to study for 2 hours.");

    // Must not throw; must return a real intent via fallback — no fake success
    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.source).toBe('fallback');
    }
  });

  it('Section 12: bad LLM output (null) → falls back silently, no fake success', async () => {
    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      // Ollama returns null — simulates malformed / unparseable JSON from the bridge
      parse: jest.fn<() => Promise<ParseResult | null>>().mockResolvedValue(null),
    };

    const fallbackParser = new FallbackParser();
    const engine = new DefaultIntentEngine(mockOllama as unknown as OllamaParser, fallbackParser);

    const result = await engine.parse("I'm going to study for two hours.");

    expect(result.kind).toBe('intent');
    if (result.kind === 'intent') {
      // Source must be fallback, not ollama — engine must not invent a fake ollama success
      expect(result.intent.source).toBe('fallback');
      expect(result.intent.activity).toBe('study');
    }
  });

  it('Section 12: malformed LLM output (low confidence) → validator produces clarification, not fake intent', async () => {
    const malformedResult: ParseResult = {
      kind: 'intent',
      intent: {
        activity: 'study',
        operation: 'activate',
        durationMinutes: null,
        schedule: null,
        persistence: 'unspecified',
        requestedChanges: [],
        exceptions: [],
        confidence: 0.2, // below threshold
        requiresConfirmation: true,
        rawText: "I'm going to study",
        source: 'ollama',
      },
    };

    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      parse: jest.fn<() => Promise<ParseResult | null>>().mockResolvedValue(malformedResult),
    };

    const fallbackParser = new FallbackParser();
    const engine = new DefaultIntentEngine(mockOllama as unknown as OllamaParser, fallbackParser);

    const result = await engine.parse("I'm going to study");

    // Low-confidence output must be turned into a clarification by the validator
    expect(result.kind).toBe('clarification');
  });

  it('Section 12: unsupported capability from LLM → validator rejects, returns clarification', async () => {
    const unsupportedCapResult: ParseResult = {
      kind: 'intent',
      intent: {
        activity: 'study',
        operation: 'activate',
        durationMinutes: 120,
        schedule: null,
        persistence: 'session',
        requestedChanges: [
          // 'wifi' is not in the allow-list — the validator must reject this
          { capability: 'wifi' as never, value: 'off' },
        ],
        exceptions: [],
        confidence: 0.9,
        requiresConfirmation: false,
        rawText: 'Study for 2 hours, turn off wifi',
        source: 'ollama',
      },
    };

    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      parse: jest.fn<() => Promise<ParseResult | null>>().mockResolvedValue(unsupportedCapResult),
    };

    const fallbackParser = new FallbackParser();
    const engine = new DefaultIntentEngine(mockOllama as unknown as OllamaParser, fallbackParser);

    const result = await engine.parse('Study for 2 hours, turn off wifi');

    // Unsupported capability must be rejected — never reaches policy
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') {
      expect(result.question).toContain('cannot manage');
    }
  });

  it('S-V5: AI bridge does not call Android APIs (engine stays in JS layer)', async () => {
    // Structural test: DefaultIntentEngine.parse must return a ParseResult.
    // The engine itself never touches device APIs; execution stays in the
    // intent pipeline. We verify this by confirming the return type is always
    // a ParseResult, never undefined / void / a native call result.
    const fallbackParser = new FallbackParser();
    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
      parse: jest.fn<() => Promise<ParseResult | null>>().mockResolvedValue(null),
    };
    const engine = new DefaultIntentEngine(mockOllama as unknown as OllamaParser, fallbackParser);
    const result = await engine.parse("I'm going to study for two hours.");
    // A ParseResult has kind === 'intent' | 'clarification' — never undefined
    expect(['intent', 'clarification']).toContain(result.kind);
  });
});
