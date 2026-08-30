/**
 * OWNER: DHREY — task D-V6 (First Vertical-Slice Policy)
 *
 * The whole spine, end to end, with NOTHING between the layers mocked:
 *
 *   text → FallbackParser → IntentValidator → memory (real SQLite) → resolve()
 *        → buildActionPlan() → ActionPlan   [stop: native boundary]
 *
 * Only two things are substituted, and neither is a layer under test:
 *   - the SQLite driver (better-sqlite3 in-memory, via setupTests.ts)
 *   - Ollama, by driving the deterministic FallbackParser — the same code path a
 *     phone takes with the LAN unreachable, so this is production code, not a stub.
 *
 * The parser, validator, repositories, precedence resolver, priority resolver and
 * planner are all the real implementations.
 */

import { getDatabase } from '../../memory/database';
import {
  ensureSeeded,
  loadProfileContext,
  overrideRepository,
  priorityRepository,
  profileRepository,
  sessionRepository,
} from '../../memory';
import { activateFromText } from '../../services/contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import { CAPABILITIES, CHANNEL_ENFORCEABLE } from '../../types';
import type { ActionPlan, Intent, ParseResult } from '../../types';

const STUDY_COMMAND = "I'm going to study for two hours.";
const STUDY = 'profile_study';

/** The real offline pipeline: real parser + real validator. */
const engine = {
  async parse(text: string): Promise<ParseResult> {
    const result = await new FallbackParser().parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

/** An engine that emits a fixed Intent, for cases the parser cannot produce. */
function fixedEngine(intent: Intent) {
  return {
    async parse(): Promise<ParseResult> {
      return { kind: 'intent', intent };
    },
  };
}

function baseIntent(over: Partial<Intent> = {}): Intent {
  return {
    activity: 'study',
    operation: 'activate',
    durationMinutes: 120,
    schedule: null,
    persistence: 'session',
    requestedChanges: [],
    exceptions: [],
    confidence: 0.95,
    requiresConfirmation: false,
    rawText: STUDY_COMMAND,
    source: 'fallback',
    ...over,
  };
}

/** Every field the frozen ActionPlan contract promises Aayush's executor. */
function assertConformsToActionPlan(plan: ActionPlan) {
  expect(typeof plan.sessionId).toBe('string');
  expect(plan.sessionId.length).toBeGreaterThan(0);
  expect(typeof plan.restoreOnEnd).toBe('boolean');
  expect(Array.isArray(plan.actions)).toBe(true);

  for (const action of plan.actions) {
    expect(CAPABILITIES as readonly string[]).toContain(action.capability);
    expect(action.value).toBeDefined();
    expect(typeof action.needsSnapshot).toBe('boolean');
    expect(typeof action.reason).toBe('string');
    expect(action.reason.length).toBeGreaterThan(0);
    expect(
      action.requiredPermission === null || typeof action.requiredPermission === 'string',
    ).toBe(true);
  }
}

async function clearStudyState() {
  await priorityRepository.clearProfile(STUDY);
  const context = await loadProfileContext('study');
  for (const o of context!.overrides) {
    await overrideRepository.delete(o.id);
  }
  for (const p of context!.preferences) {
    await profileRepository.deletePreference(p.id);
  }
}

describe('D-V6 vertical slice', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(clearStudyState);

  // ── TEST 1 — the canonical request ────────────────────────────────────────
  it('DV6-1: the canonical study sentence travels the whole pipeline', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, { engine });

    // 1-2. parsed and validated
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;
    expect(outcome.intent.activity).toBe('study');
    expect(outcome.intent.operation).toBe('activate');
    expect(outcome.intent.durationMinutes).toBe(120);
    expect(outcome.intent.confidence).toBeGreaterThanOrEqual(0.7);

    // 3-4. context resolved from stored memory, not invented
    const stored = await profileRepository.getProfileByModeKey('study');
    expect(outcome.profile.id).toBe(stored!.id);
    expect(outcome.policy.profileId).toBe(stored!.id);

    // 5-6. policy resolved from study.json defaults
    expect(outcome.policy.entries.length).toBeGreaterThan(0);
    expect(outcome.policy.durationMinutes).toBe(120);

    // 7. ActionPlan conforms to the frozen contract
    assertConformsToActionPlan(outcome.plan);
    expect(outcome.plan.actions.length).toBe(outcome.policy.entries.length);
  });

  it('DV6-1b: the session is persisted and the plan points at it', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const session = await sessionRepository.getById(outcome.plan.sessionId);

    expect(session).not.toBeNull();
    expect(session!.profileId).toBe(STUDY);
    // Nothing has touched the device.
    expect(session!.status).toBe('READY');
  });

  // ── TEST 2 — a preference reaches the plan ────────────────────────────────
  it('DV6-2: a persistent preference is reflected in the ActionPlan', async () => {
    await profileRepository.createPreference({
      id: 'dv6_pref',
      profileId: STUDY,
      capability: 'brightness',
      value: 30,
      source: 'user',
      sourceCommand: 'I like 30 when I study',
      createdAt: 1,
    });

    const outcome = await activateFromText(STUDY_COMMAND, { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const action = outcome.plan.actions.find((a) => a.capability === 'brightness');
    expect(action?.value).toBe(30);
    expect(action?.reason).toBe('from your active profile');
  });

  // ── TEST 3 — override beats preference ────────────────────────────────────
  it('DV6-3: an active override beats the persistent preference in the plan', async () => {
    const now = Date.now();
    await profileRepository.createPreference({
      id: 'dv6_pref_x',
      profileId: STUDY,
      capability: 'brightness',
      value: 30,
      source: 'user',
      sourceCommand: null,
      createdAt: 1,
    });
    await overrideRepository.create({
      id: 'dv6_ovr_y',
      profileId: STUDY,
      capability: 'brightness',
      value: 65,
      subject: null,
      effect: 'allow',
      startAt: now - 1000,
      expiresAt: now + 3_600_000,
      active: true,
      sourceCommand: 'brighten for an hour',
    });

    const outcome = await activateFromText(STUDY_COMMAND, { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const entry = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(entry?.value).toBe(65);
    expect(entry?.source).toBe('override');
    expect(outcome.plan.actions.find((a) => a.capability === 'brightness')?.value).toBe(65);
  });

  // ── TEST 4 — current instruction beats everything ─────────────────────────
  it('DV6-4: an explicit instruction beats both override and preference', async () => {
    const now = Date.now();
    await profileRepository.createPreference({
      id: 'dv6_pref_z',
      profileId: STUDY,
      capability: 'brightness',
      value: 30,
      source: 'user',
      sourceCommand: null,
      createdAt: 1,
    });
    await overrideRepository.create({
      id: 'dv6_ovr_y2',
      profileId: STUDY,
      capability: 'brightness',
      value: 65,
      subject: null,
      effect: 'allow',
      startAt: now - 1000,
      expiresAt: now + 3_600_000,
      active: true,
      sourceCommand: null,
    });

    const outcome = await activateFromText('I am going to study with brightness at 90', {
      engine,
    });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const entry = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(entry?.value).toBe(90);
    expect(entry?.source).toBe('command');
    expect(outcome.plan.actions.find((a) => a.capability === 'brightness')?.value).toBe(90);
  });

  // ── TEST 5 — expired override is ignored ──────────────────────────────────
  it('DV6-5: an expired override loses to the persistent preference', async () => {
    const now = Date.now();
    await profileRepository.createPreference({
      id: 'dv6_pref_live',
      profileId: STUDY,
      capability: 'brightness',
      value: 30,
      source: 'user',
      sourceCommand: null,
      createdAt: 1,
    });
    await overrideRepository.create({
      id: 'dv6_ovr_dead',
      profileId: STUDY,
      capability: 'brightness',
      value: 65,
      subject: null,
      effect: 'allow',
      startAt: now - 7_200_000,
      expiresAt: now - 3_600_000,
      active: true,
      sourceCommand: null,
    });

    const outcome = await activateFromText(STUDY_COMMAND, { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    const entry = outcome.policy.entries.find((e) => e.capability === 'brightness');
    expect(entry?.value).toBe(30);
    expect(entry?.source).toBe('profile');
  });

  // ── TEST 6 — priority is consumed, not duplicated ─────────────────────────
  it('DV6-6: the slice consumes the existing priority resolution', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'calls',
      subject: 'Mom',
      sourceCommand: 'let Mom call me while I study',
    });
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
    });

    const outcome = await activateFromText(STUDY_COMMAND, { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    // D-V2's resolver output, reached through the slice.
    expect(outcome.priority.resolved.channels.calls).toBe(true);
    expect(outcome.priority.resolved.subjects.calls).toEqual(['Mom']);
    expect(outcome.priority.resolved.requiresStarring).toContain('Mom');

    // D-V5's honesty rules survive the trip.
    expect(outcome.priority.resolved.preferenceOnly).toContain('whatsapp');
    expect(CHANNEL_ENFORCEABLE.whatsapp).toBe(false);
    expect(outcome.priority.request).not.toHaveProperty('whatsapp');
    expect(outcome.priority.request.repeatCallers).toBe(true);
  });

  it('DV6-6b: channels never leak into the capability ActionPlan', async () => {
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });

    const outcome = await activateFromText(STUDY_COMMAND, { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    for (const action of outcome.plan.actions) {
      expect(['calls', 'sms', 'whatsapp']).not.toContain(action.capability as string);
      expect(CAPABILITIES as readonly string[]).toContain(action.capability);
    }
  });

  // ── TEST 7 — missing profile fails safely ─────────────────────────────────
  it('DV6-7: an activity with no profile clarifies rather than guessing one', async () => {
    // 'unknown' has no mode file and no seeded row (ADR-004 cut Focus).
    const outcome = await activateFromText('focus mode please', {
      engine: fixedEngine(
        baseIntent({ activity: 'unknown', rawText: 'focus mode please', durationMinutes: 60 }),
      ),
    });

    // No random profile is selected.
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') return;
    expect(outcome.clarification.options.length).toBeGreaterThan(0);
  });

  it('DV6-7b: an unparseable sentence never reaches policy', async () => {
    const outcome = await activateFromText('asdf qwerty zxcv', { engine });
    expect(outcome.kind).toBe('clarification');
  });

  it('DV6-7c: a low-confidence intent never reaches policy', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, {
      engine: fixedEngine(baseIntent({ confidence: 0.1, requiresConfirmation: true })),
    });

    expect(outcome.kind).toBe('clarification');
  });

  // ── TEST 8 — invalid value rejected, no partial plan ──────────────────────
  it('DV6-8: an invalid capability value produces no ActionPlan at all', async () => {
    // TWO gates stand between a bad value and the device.
    // The FIRST is IntentValidator, which rejects it here and returns a Clarification —
    // policy is never entered, so no plan can exist on this path.
    // The SECOND is policy's own throw, for an Intent that bypasses the engine entirely
    // (FLOW.md §1 deep links); that path is covered by DV4-7e.
    const outcome = await activateFromText(STUDY_COMMAND, {
      engine: fixedEngine(
        baseIntent({ requestedChanges: [{ capability: 'brightness', value: -50 }] }),
      ),
    });

    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') return;
    expect(outcome.clarification.question).toMatch(/brightness/i);
    // The activated branch is the only one carrying a plan; this is not it.
    expect(outcome).not.toHaveProperty('plan');
  });

  it('DV6-8b: an out-of-range value is caught the same way', async () => {
    const outcome = await activateFromText(STUDY_COMMAND, {
      engine: fixedEngine(
        baseIntent({ requestedChanges: [{ capability: 'brightness', value: 500 }] }),
      ),
    });

    expect(outcome.kind).toBe('clarification');
    expect(outcome).not.toHaveProperty('plan');
  });

  // ── TEST 9 — unsupported is never enforced ────────────────────────────────
  it('DV6-9: an unenforceable channel is never represented as enforceable', async () => {
    await priorityRepository.addPreference({
      profileId: STUDY,
      channel: 'whatsapp',
      subject: 'Ravi',
    });

    const outcome = await activateFromText(STUDY_COMMAND, { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    // Stored and surfaced, but flagged unenforceable and never sent to Android.
    expect(outcome.priority.resolved.channels.whatsapp).toBe(true);
    expect(outcome.priority.resolved.preferenceOnly).toContain('whatsapp');
    expect(outcome.priority.resolved.requiresStarring).not.toContain('Ravi');
    expect(Object.keys(outcome.priority.request).sort()).toEqual(['calls', 'repeatCallers', 'sms']);
  });

  // ── TEST 10 — determinism ─────────────────────────────────────────────────
  it('DV6-10: the same input and state produce an identical plan every time', async () => {
    const now = 1_800_000_000_000;
    await profileRepository.createPreference({
      id: 'dv6_det_pref',
      profileId: STUDY,
      capability: 'brightness',
      value: 22,
      source: 'user',
      sourceCommand: null,
      createdAt: 1,
    });
    await priorityRepository.addPreference({ profileId: STUDY, channel: 'calls', subject: 'Mom' });

    const runs = [];
    for (let i = 0; i < 4; i++) {
      const outcome = await activateFromText(STUDY_COMMAND, { engine, now });
      expect(outcome.kind).toBe('activated');
      if (outcome.kind !== 'activated') return;
      runs.push(outcome);
    }

    const first = runs[0]!;
    for (const run of runs) {
      expect(run.policy).toEqual(first.policy);
      expect(run.priority).toEqual(first.priority);
      // sessionId is deliberately unique per activation; the actions are not.
      expect(run.plan.actions).toEqual(first.plan.actions);
      expect(run.plan.restoreOnEnd).toBe(first.plan.restoreOnEnd);
    }

    // Distinct sessions, identical plans.
    const ids = new Set(runs.map((r) => r.plan.sessionId));
    expect(ids.size).toBe(runs.length);
  });
});
