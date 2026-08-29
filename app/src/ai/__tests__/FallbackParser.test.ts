import { describe, it, expect } from '@jest/globals';
import { FallbackParser } from '../parsers/FallbackParser';

describe('FallbackParser', () => {
  it('parses a study command with a duration', async () => {
    const parser = new FallbackParser();

    const result = await parser.parse("I'm going to study for 2 hours.");

    expect(result.kind).toBe('intent');

    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.operation).toBe('activate');
      expect(result.intent.durationMinutes).toBe(120);
      expect(result.intent.source).toBe('fallback');
    }
  });

  it('parses sleep with a weekday wake-up time', async () => {
    const parser = new FallbackParser();

    const result = await parser.parse("I'm going to sleep. Wake me at 7 AM on weekdays.");

    expect(result.kind).toBe('intent');

    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('sleep');
      expect(result.intent.operation).toBe('activate');

      expect(result.intent.schedule).toEqual({
        kind: 'weekdays',
        time: '07:00',
      });

      expect(result.intent.requestedChanges).toContainEqual({
        capability: 'alarm',
        value: '07:00',
      });
    }
  });

  it('parses a silent ringer request for study', async () => {
    const parser = new FallbackParser();

    const result = await parser.parse('When I study, keep the phone silent.');

    expect(result.kind).toBe('intent');

    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.operation).toBe('teach');

      expect(result.intent.requestedChanges).toContainEqual({
        capability: 'ringer',
        value: 'silent',
      });
    }
  });

  it('parses a brightness change', async () => {
    const parser = new FallbackParser();

    const result = await parser.parse('Change Study brightness to 50%.');

    expect(result.kind).toBe('intent');

    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');
      expect(result.intent.operation).toBe('modify');

      expect(result.intent.requestedChanges).toContainEqual({
        capability: 'brightness',
        value: 50,
      });
    }
  });

  it('parses a parents contact exception', async () => {
    const parser = new FallbackParser();

    const result = await parser.parse('When I study, let my parents call me.');

    expect(result.kind).toBe('intent');

    if (result.kind === 'intent') {
      expect(result.intent.exceptions).toContainEqual({
        type: 'contactGroup',
        value: 'parents',
        effect: 'allow',
        durationMinutes: null,
      });
    }
  });

  it('parses a temporary project group exception', async () => {
    const parser = new FallbackParser();

    const result = await parser.parse('Let my project group notify me for the next 20 minutes.', {
      activeActivity: 'study',
    });

    expect(result.kind).toBe('intent');

    if (result.kind === 'intent') {
      expect(result.intent.activity).toBe('study');

      expect(result.intent.exceptions).toContainEqual({
        type: 'contactGroup',
        value: 'project group',
        effect: 'allow',
        durationMinutes: 20,
      });
    }
  });

  it('returns clarification for an unknown command', async () => {
    const parser = new FallbackParser();

    const result = await parser.parse('Turn on my washing machine.');

    expect(result.kind).toBe('clarification');

    if (result.kind === 'clarification') {
      expect(result.options).toEqual(['Study', 'Sleep']);
      expect(result.rawText).toBe('Turn on my washing machine.');
    }
  });
});
