/**
 * OWNER: DHREY — task D-V1
 *
 * The Phase 2 vertical slice, end to end and offline:
 *   "I'm going to study for two hours."  →  Intent  →  memory  →  policy  →  ActionPlan
 *
 * The engine is injected with the deterministic FallbackParser so these tests never
 * touch the network. That is the same path a phone takes with Ollama unreachable, so
 * it exercises production code rather than a stand-in.
 */

import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import { getDatabase, ensureSeeded, profileRepository } from '../../memory';
import { activateFromText } from '../contextOrchestrator';
import { ACTION_STATUSES, CAPABILITIES, type Intent, type ParseResult } from '../../types';

const STUDY_COMMAND = "I'm going to study for two hours.";

/** The offline half of the real engine: FallbackParser + the real validator. */
const offlineEngine = {
  async parse(text: string): Promise<ParseResult> {
    const parser = new FallbackParser();
    const result = await parser.parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

describe('D-V1: Intent → Memory → Policy → ActionPlan', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  it('DV1-1: the study command reaches policy and yields an activation', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, { engine: offlineEngine });

    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    expect(outcome.intent.activity).toBe('study');
    expect(outcome.intent.operation).toBe('activate');
    expect(outcome.intent.durationMinutes).toBe(120);
  });

  it('DV1-2: the Intent is validated before policy consumption', async () => {
    // An engine emitting a sub-threshold Intent. If the orchestrator did not
    // re-validate, this would reach resolve() and produce a plan.
    const lowConfidenceEngine = {
      async parse(text: string): Promise<ParseResult> {
        const intent: Intent = {
          activity: 'study',
          operation: 'activate',
          durationMinutes: 120,
          schedule: null,
          persistence: 'session',
          requestedChanges: [],
          exceptions: [],
          confidence: 0.2,
          requiresConfirmation: true,
          rawText: text,
          source: 'fallback',
        };
        return { kind: 'intent', intent };
      },
    };

    const outcome = await activateFromText(STUDY_COMMAND, { engine: lowConfidenceEngine });

    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') return;
    expect(outcome.clarification.kind).toBe('clarification');
    expect(outcome.clarification.question.length).toBeGreaterThan(0);
  });

  it('DV1-3: an unparseable sentence never reaches policy', async () => {
    const outcome = await activateFromText('purple monkey dishwasher', {
      engine: offlineEngine,
    });

    expect(outcome.kind).toBe('clarification');
  });

  it('DV1-4: the Study profile is selected from stored memory, not invented', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, { engine: offlineEngine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const stored = await profileRepository.getProfileByModeKey('study');
    expect(stored).not.toBeNull();
    expect(outcome.profile.id).toBe(stored!.id);
    expect(outcome.profile.modeKey).toBe('study');
    expect(outcome.policy.profileId).toBe(stored!.id);
  });

  it('DV1-5: the policy engine produces an ActionPlan from the mode defaults', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, { engine: offlineEngine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    // study.json defines dnd, brightness and ringer — all at the `default` tier,
    // since nothing in this run overrides them.
    const byCapability = Object.fromEntries(outcome.policy.entries.map((e) => [e.capability, e]));
    expect(byCapability.dnd?.value).toBe('priority');
    expect(byCapability.brightness?.value).toBe(40);
    expect(byCapability.ringer?.value).toBe('silent');
    for (const entry of outcome.policy.entries) {
      expect(entry.source).toBe('default');
    }

    expect(outcome.plan.actions.length).toBe(outcome.policy.entries.length);
    expect(outcome.plan.actions.length).toBeGreaterThan(0);
  });

  it('DV1-6: the output conforms to the frozen ActionPlan contract', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, { engine: offlineEngine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const { plan } = outcome;

    expect(typeof plan.sessionId).toBe('string');
    expect(plan.sessionId.length).toBeGreaterThan(0);
    expect(typeof plan.restoreOnEnd).toBe('boolean');
    expect(Array.isArray(plan.actions)).toBe(true);

    for (const action of plan.actions) {
      expect(CAPABILITIES as readonly string[]).toContain(action.capability);
      expect(typeof action.needsSnapshot).toBe('boolean');
      expect(typeof action.reason).toBe('string');
      expect(action.reason.length).toBeGreaterThan(0);
      expect(
        action.requiredPermission === null || typeof action.requiredPermission === 'string',
      ).toBe(true);
    }

    // A session-scoped context must be restorable, or "end study" cannot undo it.
    expect(plan.restoreOnEnd).toBe(true);
    expect(plan.actions.every((a) => a.needsSnapshot)).toBe(true);
  });

  it('DV1-7: the plan references a persisted session, not a fabricated id', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, { engine: offlineEngine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const { sessionRepository } = await import('../../memory');
    const session = await sessionRepository.getById(outcome.plan.sessionId);

    expect(session).not.toBeNull();
    expect(session!.profileId).toBe(outcome.profile.id);
    // Nothing has been applied to the device yet.
    expect(session!.status).toBe('READY');
    expect(ACTION_STATUSES as readonly string[]).not.toContain(session!.status);
  });

  it('DV1-8: the command is logged verbatim for Memory-screen provenance', async () => {
    const { commandRepository } = await import('../../memory');
    await activateFromText(STUDY_COMMAND, { engine: offlineEngine });

    const recent = await commandRepository.getRecentCommands(20);
    const logged = recent.find((c) => c.rawText === STUDY_COMMAND);

    expect(logged).toBeDefined();
    expect(logged!.source).toBe('fallback');
    expect(JSON.parse(logged!.intentJson).activity).toBe('study');
  });
});
