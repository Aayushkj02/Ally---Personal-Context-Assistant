/**
 * OWNER: SHLOK — Phase 6 Office Kit Scenarios & Polish
 *
 * Phase Goal (SHLOK_REMAINING_PHASES_TASKS.md §PHASE 6):
 *   Prepare the AI layer for approved Office Kit scenarios and conversational robustness.
 *   Hardware note: Physical Office Kit hardware is not available until Pune round qualification.
 *   All AI testing is performed against Samsung S24 Ultra software models / mocks.
 *
 * Covers:
 *   S6.1 — Office Intent Coverage
 *   S6.2 — Conversation Robustness
 *   S6.3 — Clarification on Ambiguous Requests
 *   S6.4 — Confidence & Safety Boundary
 *   S6.5 — Evaluation Dataset Coverage
 */

import { describe, it, expect } from '@jest/globals';
import { FallbackParser } from '../parsers/FallbackParser';
import { IntentValidator } from '../validators/IntentValidator';

const parser = new FallbackParser();

async function parseAndValidate(text: string, ctx?: { activeActivity?: 'study' | 'sleep' }) {
  const raw = await parser.parse(text, ctx);
  return IntentValidator.validate(raw);
}

// ─── S6.1 & S6.2: Office Intent Coverage & Robustness ────────────────────────

describe('S6.1 & S6.2 — Office intent coverage and conversational robustness', () => {
  it('"Start study mode." → study, activate', async () => {
    const r = await parseAndValidate('Start study mode.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('activate');
  });

  it('"I\'m going to study." → study, activate', async () => {
    const r = await parseAndValidate("I'm going to study.");
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('activate');
  });

  it('"Turn on study." → study, activate', async () => {
    const r = await parseAndValidate('Turn on study.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('activate');
  });

  it('"I need to focus for two hours." → study, activate, duration=120', async () => {
    const r = await parseAndValidate('I need to focus for two hours.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('activate');
    expect(r.intent.durationMinutes).toBe(120);
  });

  it('"Focus for 45 minutes." → study, activate, duration=45', async () => {
    const r = await parseAndValidate('Focus for 45 minutes.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.operation).toBe('activate');
    expect(r.intent.durationMinutes).toBe(45);
  });

  it('"Put my phone on silent for study." → study, activate, ringer=silent', async () => {
    const r = await parseAndValidate('Put my phone on silent for study.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.activity).toBe('study');
    expect(r.intent.requestedChanges).toContainEqual({
      capability: 'ringer',
      value: 'silent',
    });
  });
});

// ─── S6.3: Clarification for Ambiguous Requests ──────────────────────────────

describe('S6.3 — Clarification on genuinely ambiguous requests', () => {
  it('"Change the setting." → clarification (does not guess capability/mode)', async () => {
    const r = await parseAndValidate('Change the setting.');
    expect(r.kind).toBe('clarification');
  });

  it('"Let them through." → clarification (does not guess contact/channel/mode)', async () => {
    const r = await parseAndValidate('Let them through.');
    expect(r.kind).toBe('clarification');
  });

  it('"Set it for later." → clarification (does not guess time/mode)', async () => {
    const r = await parseAndValidate('Set it for later.');
    expect(r.kind).toBe('clarification');
  });

  it('"Do something." → clarification', async () => {
    const r = await parseAndValidate('Do something.');
    expect(r.kind).toBe('clarification');
  });

  it('"Adjust settings." → clarification', async () => {
    const r = await parseAndValidate('Adjust settings.');
    expect(r.kind).toBe('clarification');
  });
});

// ─── S6.4: Confidence & Safety Handling ─────────────────────────────────────

describe('S6.4 — Confidence and safety boundaries', () => {
  it('unsupported capability request yields clarification (never fakes execution)', async () => {
    const r = await parseAndValidate('Turn on wifi hotspot while I study.');
    // If intent is produced, wifi capability is omitted from requestedChanges
    if (r.kind === 'intent') {
      expect(r.intent.requestedChanges.some((c) => (c.capability as string) === 'wifi')).toBe(
        false,
      );
    } else {
      expect(r.kind).toBe('clarification');
    }
  });

  it('WhatsApp priority commands always require confirmation', async () => {
    const r = await parseAndValidate('Let my project WhatsApp group message me during study.');
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') return;

    expect(r.intent.requiresConfirmation).toBe(true);
    expect(r.intent.exceptions[0]?.channel).toBe('whatsapp');
  });

  it('preserves verbatim rawText across all office and focus commands', async () => {
    const commands = [
      'Start study mode.',
      'I need to focus for two hours.',
      'Put my phone on silent for study.',
      'Change Study brightness to 50%.',
    ];

    for (const cmd of commands) {
      const r = await parseAndValidate(cmd);
      expect(r.kind).toBe('intent');
      if (r.kind !== 'intent') continue;
      expect(r.intent.rawText).toBe(cmd);
    }
  });
});
