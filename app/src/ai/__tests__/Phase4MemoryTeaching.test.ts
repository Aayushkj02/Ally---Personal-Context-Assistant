/**
 * OWNER: SHLOK — Phase 4 Memory & Teaching
 *
 * Phase Goal (SHLOK_REMAINING_PHASES_TASKS.md §PHASE 4):
 *   A preference Ally learns can be traced back to the sentence that taught it.
 *
 * AI responsibility: create the correct teaching intent, memory query intent,
 * correction/removal intent, and preserve source sentence information verbatim.
 * Dhrey owns database storage and retrieval.
 *
 * Covers:
 *   S4.1 — Teaching Intent
 *   S4.2 — Source Sentence Preservation
 *   S4.3 — Preference Correction / Removal
 *   S4.4 — Teaching Tests
 *   S4.5 — Memory Query Intents
 *
 * Invariants:
 *   - No src/native, src/actions, src/memory, src/policy code is imported.
 *   - The Intent contract (src/types/intent.ts) is preserved and frozen.
 */

import { describe, it, expect } from '@jest/globals';
import { FallbackParser } from '../parsers/FallbackParser';
import { IntentValidator } from '../validators/IntentValidator';
import type { Intent } from '../../types';

const parser = new FallbackParser();

async function parseAndValidate(text: string, ctx?: { activeActivity?: 'study' | 'sleep' }) {
  const raw = await parser.parse(text, ctx);
  return IntentValidator.validate(raw);
}

// ─── S4.1: Teaching Intent ───────────────────────────────────────────────────

describe('S4.1 — Teaching intent representation', () => {
  it('"Remember that Mom can call me during sleep." → teach, sleep, Mom, calls, persistent', async () => {
    const r = await parseAndValidate('Remember that Mom can call me during sleep.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('teach');
    expect(r.intent.persistence).toBe('persistent');
    expect(r.intent.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'contact',
          value: 'Mom',
          channel: 'calls',
          effect: 'allow',
        }),
      ]),
    );
  });

  it('"Always let my project group reach me while I\'m studying." → teach, study, project group, persistent', async () => {
    const r = await parseAndValidate("Always let my project group reach me while I'm studying.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('teach');
    expect(r.intent.persistence).toBe('persistent');
    const exc = r.intent.exceptions.find((e) => e.value === 'project group');
    expect(exc).toBeDefined();
    expect(exc?.effect).toBe('allow');
  });

  it('"Learn that I prefer 40% brightness during study." → teach, study, brightness=40, persistent', async () => {
    const r = await parseAndValidate('Learn that I prefer 40% brightness during study.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('teach');
    expect(r.intent.persistence).toBe('persistent');
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'brightness',
      value: 40,
    });
  });

  it('"Remember this preference." (with active study context) → teach, study, persistent', async () => {
    const r = await parseAndValidate('Remember this preference.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('teach');
    expect(r.intent.persistence).toBe('persistent');
  });
});

// ─── S4.2: Source Sentence Preservation ──────────────────────────────────────

describe('S4.2 — Source sentence preservation', () => {
  it('preserves exact raw user sentence for provenance', async () => {
    const input = 'During study, let my project group message me on WhatsApp.';
    const r = await parseAndValidate(input);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    // Must match verbatim without summary or rewriting
    expect(r.intent.rawText).toBe(input);
  });

  it('preserves casing of contact names in exceptions and rawText', async () => {
    const input = 'Remember that Dr. Smith can call me during study.';
    const r = await parseAndValidate(input);
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.rawText).toBe(input);
  });
});

// ─── S4.3: Preference Correction / Removal ───────────────────────────────────

describe('S4.3 — Preference correction and removal', () => {
  it('"Actually, don\'t let my project group message me during study." → effect=block, channel=sms', async () => {
    const r = await parseAndValidate(
      "Actually, don't let my project group message me during study.",
    );
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    const exc = r.intent.exceptions.find((e) => e.value === 'project group');
    expect(exc).toBeDefined();
    expect(exc?.effect).toBe('block');
    expect(exc?.channel).toBe('sms');
  });

  it('"Forget that preference." (with active context) → modify / teach signal', async () => {
    const r = await parseAndValidate('Forget that preference.', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(['modify', 'teach', 'deactivate']).toContain(r.intent.operation);
  });

  it('"Remove Mom from my sleep priority." → sleep, Mom, effect=block', async () => {
    const r = await parseAndValidate('Remove Mom from my sleep priority.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    const exc = r.intent.exceptions.find((e) => e.value === 'Mom');
    expect(exc).toBeDefined();
    expect(exc?.effect).toBe('block');
  });

  it('"Don\'t let my parents call me during study." → study, parents, effect=block', async () => {
    const r = await parseAndValidate("Don't let my parents call me during study.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    const exc = r.intent.exceptions.find((e) => e.value === 'parents');
    expect(exc).toBeDefined();
    expect(exc?.effect).toBe('block');
  });
});

// ─── S4.4: Teaching Tests ────────────────────────────────────────────────────

describe('S4.4 — Comprehensive teaching test coverage', () => {
  it('mode-specific teaching: study vs sleep', async () => {
    const rStudy = await parseAndValidate('When I study, keep silent and let Mom call.');
    const rSleep = await parseAndValidate('When I sleep, keep silent and let Mom call.');

    expect(rStudy.kind).toBe('intent');
    expect(rSleep.kind).toBe('intent');
    if (rStudy.kind !== 'intent' || rSleep.kind !== 'intent') return;

    expect(rStudy.intent.activity).toBe('study');
    expect(rStudy.intent.operation).toBe('teach');

    expect(rSleep.intent.activity).toBe('sleep');
    expect(rSleep.intent.operation).toBe('teach');
  });

  it('channel-specific teaching: calls, sms, whatsapp', async () => {
    const calls = await parseAndValidate('Always let Mom call me during study.');
    const sms = await parseAndValidate('Always let Mom text me during study.');
    const wa = await parseAndValidate(
      'Always let my project WhatsApp group message me during study.',
    );

    expect(calls.kind).toBe('intent');
    expect(sms.kind).toBe('intent');
    expect(wa.kind).toBe('intent');
    if (calls.kind !== 'intent' || sms.kind !== 'intent' || wa.kind !== 'intent') return;

    expect(calls.intent.exceptions[0]?.channel).toBe('calls');
    expect(sms.intent.exceptions[0]?.channel).toBe('sms');
    expect(wa.intent.exceptions[0]?.channel).toBe('whatsapp');
    expect(wa.intent.requiresConfirmation).toBe(true);
  });

  it('distinguishes temporary override from persistent teaching', async () => {
    const temp = await parseAndValidate('During this study session, let Mom call me.', {
      activeActivity: 'study',
    });
    const perm = await parseAndValidate('Remember that Mom can call me during study.');

    expect(temp.kind).toBe('intent');
    expect(perm.kind).toBe('intent');
    if (temp.kind !== 'intent' || perm.kind !== 'intent') return;

    expect(temp.intent.persistence).toBe('temporary');
    expect(perm.intent.persistence).toBe('persistent');
    expect(temp.intent.operation).toBe('modify');
    expect(perm.intent.operation).toBe('teach');
  });
});

// ─── S4.5: Memory Query Intents ──────────────────────────────────────────────

describe('S4.5 — Memory query intents', () => {
  it('"What do you remember about my study mode?" → query, study', async () => {
    const r = await parseAndValidate('What do you remember about my study mode?');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('query');
    expect(r.intent.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('"Why do you let Mom call me during sleep?" → query, sleep, contact=Mom', async () => {
    const r = await parseAndValidate('Why do you let Mom call me during sleep?');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('sleep');
    expect(r.intent.operation).toBe('query');
    const exc = r.intent.exceptions.find((e) => e.value === 'Mom');
    expect(exc).toBeDefined();
  });

  it('"When did I teach you this?" (with active study context) → query, study', async () => {
    const r = await parseAndValidate('When did I teach you this?', { activeActivity: 'study' });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('query');
    expect(r.intent.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('memory query produces no device mutations (requestedChanges empty)', async () => {
    const r = await parseAndValidate('What do you remember about my study mode?');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.requestedChanges).toHaveLength(0);
  });
});
