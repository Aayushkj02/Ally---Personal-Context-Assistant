import { describe, it, expect } from '@jest/globals';
import { FallbackParser } from '../parsers/FallbackParser';

describe('FallbackParser', () => {
  // ── Existing tests ──────────────────────────────────────────────────────

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
      expect(result.intent.exceptions).toContainEqual(
        expect.objectContaining({
          type: 'contactGroup',
          value: 'parents',
          effect: 'allow',
          durationMinutes: null,
        }),
      );
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

      expect(result.intent.exceptions).toContainEqual(
        expect.objectContaining({
          type: 'contactGroup',
          value: 'project group',
          effect: 'allow',
          durationMinutes: 20,
        }),
      );
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

  // ── Phase 2 vertical-slice tests (Task S-V1, S-V6, S-V7) ────────────────

  describe('Phase 2 vertical slice', () => {
    it('S-V1: golden study command → activity=study, duration=120, source=fallback', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse("I'm going to study for two hours.");

      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('study');
        expect(result.intent.operation).toBe('activate');
        expect(result.intent.durationMinutes).toBe(120);
        expect(result.intent.source).toBe('fallback');
      }
    });

    it('S-V6: "Undo that" deactivates the active activity', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse('Undo that.', { activeActivity: 'study' });

      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.operation).toBe('deactivate');
        expect(result.intent.activity).toBe('study');
      }
    });

    it('S-V6: "I\'m done studying" deactivates study', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse("I'm done studying.");

      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('study');
        expect(result.intent.operation).toBe('deactivate');
      }
    });

    it('S-V7: "Let Mom call me while I study" → channel=calls, individual contact', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse('Let Mom call me while I study.');

      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('study');
        const exc = result.intent.exceptions.find((e) => e.value === 'Mom');
        expect(exc).toBeDefined();
        expect(exc?.type).toBe('contact');
        expect(exc?.channel).toBe('calls');
        expect(exc?.effect).toBe('allow');
      }
    });

    it('S-V7: "Let Mom\'s SMS through while I study" → channel=sms', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse("Let Mom's SMS through while I study.");

      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('study');
        const exc = result.intent.exceptions.find((e) => e.value === 'Mom');
        expect(exc).toBeDefined();
        expect(exc?.channel).toBe('sms');
      }
    });

    it('S-V7: WhatsApp group exception → channel=whatsapp, requiresConfirmation=true', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse('Let my project WhatsApp group through while I study.', {
        activeActivity: 'study',
      });

      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('study');
        // WhatsApp is preference_only; the parser signals this via requiresConfirmation
        expect(result.intent.requiresConfirmation).toBe(true);
        const exc = result.intent.exceptions.find((e) => e.value === 'project group');
        expect(exc).toBeDefined();
        expect(exc?.channel).toBe('whatsapp');
      }
    });

    it('S-V6: "Let my parents call me while I study" → parents exception, calls channel', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse('Let my parents call me while I study.');

      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('study');
        const exc = result.intent.exceptions.find((e) => e.value === 'parents');
        expect(exc).toBeDefined();
        expect(exc?.channel).toBe('calls');
      }
    });
  });

  // ── Mode mapping (S-V4) ──────────────────────────────────────────────────

  describe('S-V4 mode mapping', () => {
    it('study keyword maps to study activity', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse('Start studying for 1 hour.');
      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('study');
      }
    });

    it('sleep/bed keyword maps to sleep activity', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse('Going to bed. Wake me at 7 AM.');
      expect(result.kind).toBe('intent');
      if (result.kind === 'intent') {
        expect(result.intent.activity).toBe('sleep');
      }
    });

    it('unsupported activity returns clarification, not a fake intent', async () => {
      const parser = new FallbackParser();
      const result = await parser.parse('Start my workout session.');
      expect(result.kind).toBe('clarification');
    });
  });
});
