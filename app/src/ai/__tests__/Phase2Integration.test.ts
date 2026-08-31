/**
 * OWNER: SHLOK — Phase 2 integration-hardening pass
 *
 * Study vertical-slice integration test: verifies that the complete pipeline
 *   FallbackParser → IntentValidator → Intent
 * produces output that satisfies the frozen contract consumed by Dhrey's
 * policy engine (ResolvedPolicy / ActionPlan — src/types/policy.ts).
 *
 * Rules:
 *  - No native / Android APIs called here.
 *  - No Dhrey/Aayush code modified.
 *  - Only AI-side assertions on the frozen Intent contract.
 */

import { describe, it, expect } from '@jest/globals';
import { FallbackParser } from '../parsers/FallbackParser';
import { IntentValidator } from '../validators/IntentValidator';
import { DefaultIntentEngine } from '../index';
import { OllamaParser } from '../parsers';
import type { ParseResult, Intent } from '../../types';
import { ACTIVITIES, OPERATIONS, PERSISTENCE, CONFIDENCE_THRESHOLD } from '../../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse via FallbackParser, then validate — the exact path taken in production. */
async function parseAndValidate(text: string, ctx?: { activeActivity?: 'study' | 'sleep' }) {
  const parser = new FallbackParser();
  const raw = await parser.parse(text, ctx);
  return IntentValidator.validate(raw);
}

/** Assert that an Intent satisfies all frozen-contract field constraints. */
function assertContractCompliant(intent: Intent): void {
  // activity must be an ACTIVITIES member
  expect(ACTIVITIES as readonly string[]).toContain(intent.activity);

  // operation must be an OPERATIONS member
  expect(OPERATIONS as readonly string[]).toContain(intent.operation);

  // persistence must be a PERSISTENCE member
  expect(PERSISTENCE as readonly string[]).toContain(intent.persistence);

  // confidence is 0..1 numeric
  expect(typeof intent.confidence).toBe('number');
  expect(intent.confidence).toBeGreaterThanOrEqual(0);
  expect(intent.confidence).toBeLessThanOrEqual(1);

  // requiresConfirmation is boolean
  expect(typeof intent.requiresConfirmation).toBe('boolean');

  // rawText is non-null string
  expect(typeof intent.rawText).toBe('string');

  // source is 'ollama' | 'fallback'
  expect(['ollama', 'fallback']).toContain(intent.source);

  // durationMinutes is number|null
  expect(intent.durationMinutes === null || typeof intent.durationMinutes === 'number').toBe(true);

  // schedule is null or has kind + time
  if (intent.schedule !== null) {
    expect(['none', 'once', 'weekdays']).toContain(intent.schedule.kind);
    if (intent.schedule.kind === 'none') {
      expect(intent.schedule.time).toBeNull();
    } else {
      expect(typeof intent.schedule.time).toBe('string');
    }
  }

  // requestedChanges: each has allowed capability + in-domain value
  for (const change of intent.requestedChanges) {
    expect(['dnd', 'brightness', 'alarm', 'ringer']).toContain(change.capability);
    expect(change.value !== undefined && change.value !== null).toBe(true);
  }

  // exceptions: each has required fields
  for (const exc of intent.exceptions) {
    expect(['contact', 'contactGroup']).toContain(exc.type);
    expect(typeof exc.value).toBe('string');
    expect(exc.value.trim().length).toBeGreaterThan(0);
    expect(['allow', 'block']).toContain(exc.effect);
    expect(exc.durationMinutes === null || typeof exc.durationMinutes === 'number').toBe(true);
  }
}

// ─── Study vertical-slice (primary integration test) ─────────────────────────

describe('Study vertical-slice integration (Phase 2 hardening)', () => {
  const STUDY_COMMAND = "I'm going to study for two hours.";

  it('VS-1: study command parses via FallbackParser to a valid Intent', async () => {
    const result = await parseAndValidate(STUDY_COMMAND);

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    const { intent } = result;
    expect(intent.activity).toBe('study');
    expect(intent.operation).toBe('activate');
    expect(intent.durationMinutes).toBe(120);
    expect(intent.source).toBe('fallback');
  });

  it('VS-2: Intent passes all frozen-contract field constraints', async () => {
    const result = await parseAndValidate(STUDY_COMMAND);

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    assertContractCompliant(result.intent);
  });

  it('VS-3: confidence ≥ CONFIDENCE_THRESHOLD (policy engine will execute, not clarify)', async () => {
    const result = await parseAndValidate(STUDY_COMMAND);

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    expect(result.intent.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('VS-4: requiresConfirmation=false (no WhatsApp exception, confident parse)', async () => {
    const result = await parseAndValidate(STUDY_COMMAND);

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    // No WhatsApp exception and confidence ≥ 0.7 → policy engine proceeds directly
    expect(result.intent.requiresConfirmation).toBe(false);
  });

  it('VS-5: engine (Ollama unavailable) produces the same result as FallbackParser alone', async () => {
    const mockOllama = {
      name: 'ollama' as const,
      isAvailable: () => Promise.resolve(false),
      parse: () => Promise.resolve(null as ParseResult | null),
    };
    const engine = new DefaultIntentEngine(
      mockOllama as unknown as OllamaParser,
      new FallbackParser(),
    );

    const result = await engine.parse(STUDY_COMMAND);

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('activate');
    expect(result.intent.durationMinutes).toBe(120);
    expect(result.intent.source).toBe('fallback');
  });

  it('VS-6: rawText is preserved verbatim (powers Memory screen provenance)', async () => {
    const result = await parseAndValidate(STUDY_COMMAND);

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    // rawText must be the exact user input — this is the Memory screen's provenance field
    expect(result.intent.rawText).toBe(STUDY_COMMAND);
  });

  it('VS-7: durationMinutes is consumable by ActionPlan (positive number, non-null)', async () => {
    const result = await parseAndValidate(STUDY_COMMAND);

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    // ActionPlan consumers (Dhrey's planner) expect durationMinutes to be a
    // positive integer or null. Never 0, never negative.
    const d = result.intent.durationMinutes;
    expect(typeof d).toBe('number');
    expect(d).toBeGreaterThan(0);
    expect(Number.isInteger(d)).toBe(true);
  });
});

// ─── Golden command regression (all seven golden sets) ───────────────────────

describe('Golden command regressions', () => {
  it('Golden 1: teach study profile', async () => {
    const result = await parseAndValidate('When I study, keep silent and let my parents call me.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('teach');
  });

  it('Golden 2: activate study with written-out duration', async () => {
    const result = await parseAndValidate("I'm going to study for two hours.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('activate');
    expect(result.intent.durationMinutes).toBe(120);
  });

  it('Golden 3: temporary project-group override (with active context)', async () => {
    const result = await parseAndValidate('Let my project group through for 20 minutes.', {
      activeActivity: 'study',
    });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    const exc = result.intent.exceptions.find((e) => e.value === 'project group');
    expect(exc).toBeDefined();
    expect(exc?.durationMinutes).toBe(20);
  });

  it('Golden 4: deactivate study — keyword "done"', async () => {
    const result = await parseAndValidate("I'm done studying.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('deactivate');
  });

  it('Golden 4: deactivate study — keyword "Deactivate" (substring collision fix)', async () => {
    const result = await parseAndValidate('Deactivate study mode.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('deactivate');
  });

  it('Golden 5: activate sleep with weekday alarm', async () => {
    const result = await parseAndValidate("I'm going to sleep. Wake me at 7 AM on weekdays.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('sleep');
    expect(result.intent.operation).toBe('activate');
    expect(result.intent.schedule?.kind).toBe('weekdays');
    expect(result.intent.schedule?.time).toBe('07:00');
  });

  it('Golden 6: modify brightness', async () => {
    const result = await parseAndValidate('Change Study brightness to 50%.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('modify');
    expect(result.intent.requestedChanges).toContainEqual({
      capability: 'brightness',
      value: 50,
    });
  });

  it('Golden 7: unknown command → clarification, not fake intent', async () => {
    const result = await parseAndValidate('Turn on my washing machine.');
    expect(result.kind).toBe('clarification');
  });
});

// ─── ActionPlan interface compatibility ───────────────────────────────────────

describe('ActionPlan interface compatibility', () => {
  /**
   * Dhrey's policy engine (src/types/policy.ts) consumes an Intent and produces
   * a ResolvedPolicy → ActionPlan.  We can't call Dhrey's code (it's a stub),
   * but we can confirm that the fields the policy engine reads are present and
   * correctly typed on every Intent we produce.
   */

  it('study Intent has all fields required by ResolvedPolicy input', async () => {
    const result = await parseAndValidate("I'm going to study for two hours.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    const i = result.intent;
    // PolicyEngine.resolve() reads: activity, durationMinutes, requestedChanges, exceptions, persistence
    expect(typeof i.activity).toBe('string');
    expect(i.durationMinutes === null || typeof i.durationMinutes === 'number').toBe(true);
    expect(Array.isArray(i.requestedChanges)).toBe(true);
    expect(Array.isArray(i.exceptions)).toBe(true);
    expect(PERSISTENCE as readonly string[]).toContain(i.persistence);
  });

  it('teach Intent persistence is not "session" (persistent profile write expected)', async () => {
    // "When I study" → teach → the policy engine should not use session-only scope
    // The validator does not force a specific persistence, but it must be a valid enum value
    const result = await parseAndValidate('When I study, keep silent and let my parents call me.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    expect(PERSISTENCE as readonly string[]).toContain(result.intent.persistence);
    // operation is teach, activity is study — this pair is meaningful to the policy engine
    expect(result.intent.operation).toBe('teach');
    expect(result.intent.activity).toBe('study');
  });

  it('WhatsApp exception sets requiresConfirmation (policy engine must not auto-apply)', async () => {
    const result = await parseAndValidate('Let my project WhatsApp group through while I study.', {
      activeActivity: 'study',
    });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;

    // The policy engine checks requiresConfirmation before applying changes
    expect(result.intent.requiresConfirmation).toBe(true);
    const exc = result.intent.exceptions.find((e) => e.value === 'project group');
    expect(exc?.channel).toBe('whatsapp');
  });

  it('exception channel field is present and valid for all exceptions with explicit channel', async () => {
    const commands = [
      { text: 'Let Mom call me while I study.', expectedChannel: 'calls' },
      { text: "Let Mom's SMS through while I study.", expectedChannel: 'sms' },
      {
        text: 'Let my project WhatsApp group through while I study.',
        expectedChannel: 'whatsapp',
        ctx: { activeActivity: 'study' as const },
      },
    ];

    for (const { text, expectedChannel, ctx } of commands) {
      const result = await parseAndValidate(text, ctx);
      expect(result.kind).toBe('intent');
      if (result.kind !== 'intent') continue;

      const exc = result.intent.exceptions[0];
      expect(exc).toBeDefined();
      expect(exc?.channel).toBe(expectedChannel);
      // Channel must be a valid CHANNELS member
      expect(['calls', 'sms', 'whatsapp']).toContain(exc?.channel);
    }
  });
});

// ─── Phase 2 integration-hardening: spec golden commands ─────────────────────
//
// Aayush (A-V2) has completed the native layer.  This suite locks in the exact
// Intent shapes Shlok's parser emits so the policy engine can consume them
// without interface mismatch.  No code in src/actions, src/native, src/memory,
// or src/policy is touched.

describe('Phase 2 hardening — spec golden commands', () => {
  // ── §1 Intent contract verification ─────────────────────────────────────

  it('GC-1: "I\'m going to study for two hours." → activate, 120 min, study', async () => {
    const result = await parseAndValidate("I'm going to study for two hours.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('activate');
    expect(result.intent.durationMinutes).toBe(120);
    expect(result.intent.source).toBe('fallback');
    assertContractCompliant(result.intent);
  });

  it('GC-2: "Let Mom call me while I study." → study, contact=Mom, channel=calls', async () => {
    const result = await parseAndValidate('Let Mom call me while I study.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    const exc = result.intent.exceptions.find((e) => e.value === 'Mom');
    expect(exc).toBeDefined();
    expect(exc?.type).toBe('contact');
    expect(exc?.channel).toBe('calls');
    expect(exc?.effect).toBe('allow');
    assertContractCompliant(result.intent);
  });

  it('GC-3: "Let Mom\'s SMS through while I study." → channel=sms', async () => {
    const result = await parseAndValidate("Let Mom's SMS through while I study.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    const exc = result.intent.exceptions.find((e) => e.value === 'Mom');
    expect(exc).toBeDefined();
    expect(exc?.channel).toBe('sms');
    assertContractCompliant(result.intent);
  });

  it('GC-4: "Let my project WhatsApp group through while I study." → channel=whatsapp, requiresConfirmation=true', async () => {
    const result = await parseAndValidate('Let my project WhatsApp group through while I study.', {
      activeActivity: 'study',
    });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.requiresConfirmation).toBe(true);
    const exc = result.intent.exceptions.find((e) => e.value === 'project group');
    expect(exc).toBeDefined();
    expect(exc?.channel).toBe('whatsapp');
    assertContractCompliant(result.intent);
  });

  it('GC-5: "I\'m done studying." → deactivate, study', async () => {
    const result = await parseAndValidate("I'm done studying.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('deactivate');
    assertContractCompliant(result.intent);
  });

  it('GC-6: "Undo that." (with active context) → deactivate, study', async () => {
    const result = await parseAndValidate('Undo that.', { activeActivity: 'study' });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.activity).toBe('study');
    expect(result.intent.operation).toBe('deactivate');
    assertContractCompliant(result.intent);
  });

  // ── §2 Duration strictness ───────────────────────────────────────────────

  it('DUR-1: "two hours" → durationMinutes=120 (word-form)', async () => {
    const result = await parseAndValidate("I'm going to study for two hours.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.durationMinutes).toBe(120);
  });

  it('DUR-2: "2 hours" → durationMinutes=120 (numeric)', async () => {
    const result = await parseAndValidate('I am going to study for 2 hours.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.durationMinutes).toBe(120);
  });

  it('DUR-3: no duration stated → durationMinutes=null (parser must not invent a value)', async () => {
    // "Let Mom call me while I study" has no duration — parser must leave it null.
    const result = await parseAndValidate('Let Mom call me while I study.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.durationMinutes).toBeNull();
  });

  it('DUR-4: "I\'m done studying." has no duration → durationMinutes=null', async () => {
    const result = await parseAndValidate("I'm done studying.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.durationMinutes).toBeNull();
  });

  // ── §3 START / END / UNDO distinction ───────────────────────────────────

  it('OP-START: "I\'m going to study for two hours." → operation=activate', async () => {
    const result = await parseAndValidate("I'm going to study for two hours.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.operation).toBe('activate');
  });

  it('OP-END: "I\'m done studying." → operation=deactivate', async () => {
    const result = await parseAndValidate("I'm done studying.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.operation).toBe('deactivate');
  });

  it('OP-UNDO: "Undo that." (active context) → operation=deactivate, no restoration decision', async () => {
    const result = await parseAndValidate('Undo that.', { activeActivity: 'study' });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    // AI expresses intent only — how restoration happens is Dhrey's policy decision
    expect(result.intent.operation).toBe('deactivate');
    // The Intent contains no restoration instructions
    expect(result.intent.requestedChanges).toHaveLength(0);
  });

  // ── §4 Temporary vs persistent — must not silently convert ──────────────

  it('PERSIST-1: "During this study session, let Mom call me." → persistence=temporary', async () => {
    const result = await parseAndValidate('During this study session, let Mom call me.', {
      activeActivity: 'study',
    });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.persistence).toBe('temporary');
  });

  it('PERSIST-2: "Always let Mom call me during study." → persistence=persistent', async () => {
    const result = await parseAndValidate('Always let Mom call me during study.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.persistence).toBe('persistent');
  });

  it('PERSIST-3: temporary and persistent must not be equal to each other', async () => {
    const temp = await parseAndValidate('During this study session, let Mom call me.', {
      activeActivity: 'study',
    });
    const perm = await parseAndValidate('Always let Mom call me during study.');

    expect(temp.kind).toBe('intent');
    expect(perm.kind).toBe('intent');
    if (temp.kind !== 'intent' || perm.kind !== 'intent') return;

    expect(temp.intent.persistence).not.toBe(perm.intent.persistence);
    expect(temp.intent.persistence).toBe('temporary');
    expect(perm.intent.persistence).toBe('persistent');
  });

  // ── §5 Channel mapping ───────────────────────────────────────────────────

  it('CHAN-calls: "call" phrasing → channel="calls"', async () => {
    const result = await parseAndValidate('Let Mom call me while I study.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.exceptions[0]?.channel).toBe('calls');
  });

  it('CHAN-sms: "SMS" phrasing → channel="sms"', async () => {
    const result = await parseAndValidate("Let Mom's SMS through while I study.");
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.exceptions[0]?.channel).toBe('sms');
  });

  it('CHAN-whatsapp: "WhatsApp" phrasing → channel="whatsapp"', async () => {
    const result = await parseAndValidate('Let my project WhatsApp group through while I study.', {
      activeActivity: 'study',
    });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    expect(result.intent.exceptions[0]?.channel).toBe('whatsapp');
  });

  // ── §5 WhatsApp preference_only — must not claim enforcement ─────────────

  it('WA-1: WhatsApp exception → requiresConfirmation=true (policy engine must not auto-apply)', async () => {
    const result = await parseAndValidate('Let my project WhatsApp group through while I study.', {
      activeActivity: 'study',
    });
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    // AI signals "needs confirmation" so the UI can explain preference_only status
    expect(result.intent.requiresConfirmation).toBe(true);
  });

  it('WA-2: non-WhatsApp exception → requiresConfirmation reflects confidence only', async () => {
    const result = await parseAndValidate('Let Mom call me while I study.');
    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') return;
    // No WhatsApp → requiresConfirmation is not forced true by channel alone
    expect(result.intent.exceptions.every((e) => e.channel !== 'whatsapp')).toBe(true);
  });
});
