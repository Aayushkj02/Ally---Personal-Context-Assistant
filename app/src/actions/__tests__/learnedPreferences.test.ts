/**
 * OWNER: AAYUSH — Phase 4 (A4.1, A4.2, A4.3)
 *
 * A remembered preference, followed all the way to the device and back.
 *
 * THIS IS AN INTEGRATION TEST ON PURPOSE. It uses the REAL orchestrator, the REAL memory layer
 * against an in-memory SQLite, the REAL policy resolver and planner, the REAL snapshot repository,
 * and the real executor — with only the phone itself swapped for MockDevice. Nothing here builds
 * an ActionPlan by hand. A test that constructs its own plan proves the executor works on plans
 * that test wrote, which is not the question Phase 4 asks.
 *
 *   profileRepository.createPreference   (Dhrey's storage)
 *        ↓  loadProfileContext           (Dhrey's retrieval)
 *        ↓  resolve()                    (Dhrey's precedence)
 *        ↓  buildActionPlan()            (Dhrey's planner)
 *        ↓  startContext()               (MINE — the first line of this that Aayush owns)
 *        ↓  DeviceCapability             (mine)
 *        ↓  the phone
 *
 * WHAT IS SIMULATED, AND SAID PLAINLY: the step from the sentence "Remember that I prefer 25%
 * brightness during study" to a row in `preference` does not exist yet in the product. Shlok's
 * parser classifies it as `operation: 'teach'`, and nothing consumes that — `activateFromText`
 * ignores `intent.operation` entirely. Writing preferences is Dhrey's layer, so these tests seed
 * the row through his public repository rather than inventing a teaching path in mine. Everything
 * downstream of that row is the real thing.
 */

import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';

import { profileRepository, ensureSeeded } from '../../memory';
import { getDatabase } from '../../memory/database';
import { activateFromText } from '../../services/contextOrchestrator';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import type { ParseResult } from '../../types/intent';
import type { ActivationOutcome } from '../../services/contextOrchestrator';
import {
  mockRegistry,
  __resetMockState,
  __setMockBrightnessRaw,
  __getMockBrightnessRaw,
  __getMockBrightnessPercent,
  __getMockState,
} from '../../native/MockDevice';
import { startContext, endContext, createRepositorySnapshotStore, explainResults } from '../index';
import type { ActionPlan, ActionResult, PlannedAction } from '../../types';

const STUDY_PROFILE = 'profile_study';
const STUDY_SENTENCE = "I'm going to study for two hours.";

/** The device's own brightness before Ally is asked for anything. 187 reports as 73%. */
const USER_RAW = 187;

/** Deliberately NOT 40. study.json's default is 40, so a taught 40 would prove nothing. */
const TAUGHT_PERCENT = 25;

/** No network in tests; the fallback parser is the real one, just offline. */
const offlineEngine = {
  async parse(text: string): Promise<ParseResult> {
    const result = await new FallbackParser().parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

/** A plain brightness action, for the two pairing tests that need a plan without the database. */
const BRIGHTNESS_ACTION: PlannedAction = {
  capability: 'brightness',
  value: 40,
  needsSnapshot: true,
  requiredPermission: 'write_settings',
  reason: 'from system defaults',
};

const seededPreferences: string[] = [];

/** Stores a preference the way a teaching command eventually will. Dhrey's API, unmodified. */
async function rememberBrightness(percent: number, sentence: string): Promise<string> {
  const id = `a4_pref_${seededPreferences.length}_${Date.now().toString(36)}`;
  await profileRepository.createPreference({
    id,
    profileId: STUDY_PROFILE,
    capability: 'brightness',
    value: percent,
    source: 'user',
    // The provenance that makes this a memory rather than a setting.
    sourceCommand: sentence,
    createdAt: Date.now(),
  });
  seededPreferences.push(id);
  return id;
}

async function forgetAll(): Promise<void> {
  for (const id of seededPreferences.splice(0)) {
    await profileRepository.deletePreference(id);
  }
}

/** Runs the real pipeline and returns the activation, failing loudly on a clarification. */
async function activateStudy(): Promise<Extract<ActivationOutcome, { kind: 'activated' }>> {
  const outcome = await activateFromText(STUDY_SENTENCE, { engine: offlineEngine });
  if (outcome.kind !== 'activated') {
    const errorMsg = outcome.kind === 'clarification'
      ? outcome.clarification.question
      : `unexpected kind: ${outcome.kind}`;
    throw new Error(`expected an activation, got: ${errorMsg}`);
  }
  return outcome;
}

beforeAll(async () => {
  await getDatabase();
  await ensureSeeded();
});

afterEach(async () => {
  await forgetAll();
  __resetMockState();
});

// ---------------------------------------------------------------------------
// A4.1 — the stored preference reaches the device
// ---------------------------------------------------------------------------

describe('A4.1 — a remembered preference drives the phone', () => {
  it('with nothing remembered, the mode default is what lands on the device', async () => {
    __setMockBrightnessRaw(USER_RAW);
    const { plan } = await activateStudy();

    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });

    expect(__getMockBrightnessPercent()).toBe(40); // study.json
    expect(r.results.find((x) => x.capability === 'brightness')?.status).toBe('applied');
  });

  it('a remembered preference beats the mode default, all the way to the device', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'Remember that I prefer 25% brightness during study');
    __setMockBrightnessRaw(USER_RAW);

    const { plan, policy } = await activateStudy();

    // The plan Dhrey handed over already carries the taught value. Aayush does not choose it.
    const planned = plan.actions.find((a) => a.capability === 'brightness');
    expect(planned?.value).toBe(TAUGHT_PERCENT);
    expect(policy.entries.find((e) => e.capability === 'brightness')?.source).toBe('profile');

    await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });

    // 25%, not the 40% study.json would have asked for.
    expect(__getMockBrightnessPercent()).toBe(TAUGHT_PERCENT);
  });

  it('carries the provenance through to the plan, rather than losing it at the boundary', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'Remember that I prefer 25% brightness during study');
    const { plan } = await activateStudy();

    const planned = plan.actions.find((a) => a.capability === 'brightness');
    const dnd = plan.actions.find((a) => a.capability === 'dnd');

    // Two rows in the same plan, two different origins, and the difference is visible.
    expect(planned?.reason).toMatch(/profile/i);
    expect(dnd?.reason).toMatch(/default/i);
    expect(planned?.reason).not.toBe(dnd?.reason);
  });

  it('goes through the executor — the taught value is snapshotted like any other', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'Remember that I prefer 25% brightness during study');
    __setMockBrightnessRaw(USER_RAW);

    const snapshots = createRepositorySnapshotStore();
    const { plan } = await activateStudy();
    await startContext(plan, { registry: mockRegistry, snapshots });

    const rows = await snapshots.forSession(plan.sessionId);
    const brightnessRow = rows.find((r) => r.capability === 'brightness');

    // What was captured is the USER'S value, not the one they taught Ally to apply.
    expect(brightnessRow?.previousValue).toBe(73);
    // All three of study.json's actions, ringer included. The mock implements ringer, so it
    // applies and is captured here; on the Samsung it reports not_supported and no row is
    // written at all (T5 is still open). Both are correct — the executor captures what it is
    // about to change, and nothing more.
    expect(rows.map((r) => r.capability).sort()).toEqual(['brightness', 'dnd', 'ringer']);
  });
});

// ---------------------------------------------------------------------------
// A4.2 — a learned preference is still fully reversible
// ---------------------------------------------------------------------------

describe('A4.2 — a learned preference does not weaken restoration', () => {
  it('ends by putting back the exact raw value the user had, not the taught one', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'Remember that I prefer 25% brightness during study');
    __setMockBrightnessRaw(USER_RAW);

    const snapshots = createRepositorySnapshotStore();
    const { plan } = await activateStudy();
    await startContext(plan, { registry: mockRegistry, snapshots });
    expect(__getMockBrightnessPercent()).toBe(TAUGHT_PERCENT);

    const end = await endContext(plan.sessionId, { registry: mockRegistry, snapshots });

    expect(end.state).toBe('IDLE');
    // 187 exactly — a preference the user taught Ally is still Ally's to give back.
    expect(__getMockBrightnessRaw()).toBe(USER_RAW);
    expect(__getMockState().dnd).toBe('off');
  });

  it('survives a process death with the taught value applied', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'Remember that I prefer 25% brightness during study');
    __setMockBrightnessRaw(USER_RAW);

    const { plan } = await activateStudy();
    await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });

    // A brand new store, standing in for a fresh process with nothing in memory. The snapshots
    // are read back out of Dhrey's table by session id alone.
    const afterRestart = createRepositorySnapshotStore();
    const end = await endContext(plan.sessionId, {
      registry: mockRegistry,
      snapshots: afterRestart,
    });

    expect(end.state).toBe('IDLE');
    expect(__getMockBrightnessRaw()).toBe(USER_RAW);
  });
});

// ---------------------------------------------------------------------------
// A4.2 — the provenance survives the executor boundary
// ---------------------------------------------------------------------------

describe('A4.2 — Ally can say why, not just what', () => {
  it('pairs every outcome with the reason its planned action carried', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'Remember that I prefer 25% brightness during study');
    __setMockBrightnessRaw(USER_RAW);

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });

    expect(r.explained).toHaveLength(r.results.length);
    for (const [i, e] of r.explained.entries()) {
      expect(e.result).toBe(r.results[i]);
      expect(e.reason).toBe(plan.actions[i]?.reason);
    }
  });

  it('distinguishes a value the user taught from one they never chose, in the same run', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'Remember that I prefer 25% brightness during study');
    __setMockBrightnessRaw(USER_RAW);

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });

    const byCapability = new Map(r.explained.map((e) => [e.result.capability, e.reason]));

    // This is the whole point of the product: the screen can now say which of these the user
    // is responsible for and which Ally chose for them.
    expect(byCapability.get('brightness')).toMatch(/profile/i);
    expect(byCapability.get('dnd')).toMatch(/default/i);
  });

  it('invents nothing — the sentence comes from the plan, copied verbatim', async () => {
    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });

    const planned = plan.actions.map((a) => a.reason);
    expect(r.explained.map((e) => e.reason)).toEqual(planned);
  });

  it('pairs positionally, so two actions on one capability keep their own reasons', () => {
    // A plan may legitimately name the same capability twice. Matching on capability instead of
    // position would attribute the first action's reason to both rows.
    const twice: ActionPlan = {
      sessionId: 'sess_x',
      restoreOnEnd: true,
      actions: [
        { ...BRIGHTNESS_ACTION, value: 30, reason: 'from your active profile' },
        { ...BRIGHTNESS_ACTION, value: 10, reason: 'from your current command' },
      ],
    };
    const results: ActionResult[] = [
      { capability: 'brightness', status: 'applied', beforeValue: 73, afterValue: 30, message: '' },
      { capability: 'brightness', status: 'applied', beforeValue: 30, afterValue: 10, message: '' },
    ];

    expect(explainResults(twice, results).map((e) => e.reason)).toEqual([
      'from your active profile',
      'from your current command',
    ]);
  });

  it('gives a null reason to a row no plan produced, rather than dropping it', () => {
    // restoreSession() can append a row for the borrowed notification policy (ADR-125). It was
    // never planned, so there is no reason to give — and losing the row would mean the screen
    // showed fewer things than actually happened.
    const plan: ActionPlan = {
      sessionId: 'sess_y',
      restoreOnEnd: true,
      actions: [BRIGHTNESS_ACTION],
    };
    const results: ActionResult[] = [
      {
        capability: 'brightness',
        status: 'restored',
        beforeValue: 40,
        afterValue: 73,
        message: '',
      },
      { capability: 'dnd', status: 'restored', beforeValue: null, afterValue: null, message: '' },
    ];

    const explained = explainResults(plan, results);
    expect(explained).toHaveLength(2);
    expect(explained[1]?.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A4.3 — removing the preference stops the behaviour
// ---------------------------------------------------------------------------

describe('A4.3 — a preference that is removed stops driving the device', () => {
  it('falls back to the mode default once the preference is deleted', async () => {
    const id = await rememberBrightness(TAUGHT_PERCENT, 'I prefer 25% when studying');
    __setMockBrightnessRaw(USER_RAW);

    const first = await activateStudy();
    await startContext(first.plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });
    expect(__getMockBrightnessPercent()).toBe(TAUGHT_PERCENT);

    // The user changes their mind. Deleting the row is Dhrey's operation; the point of this test
    // is that nothing on Aayush's side has cached the old value anywhere.
    await profileRepository.deletePreference(id);
    seededPreferences.length = 0;
    __resetMockState();
    __setMockBrightnessRaw(USER_RAW);

    const second = await activateStudy();
    expect(second.plan.actions.find((a) => a.capability === 'brightness')?.value).toBe(40);

    await startContext(second.plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });
    expect(__getMockBrightnessPercent()).toBe(40);
  });

  it('a replaced preference applies the new value, not the old one', async () => {
    await rememberBrightness(TAUGHT_PERCENT, 'I prefer 25% when studying');
    __setMockBrightnessRaw(USER_RAW);

    // Dhrey's resolver takes the LAST matching preference row, so a later row replaces an
    // earlier one. Asserted here because the device outcome depends on it, not to re-test his
    // precedence: if this ever changed, Ally would apply a value the user had overwritten.
    await rememberBrightness(60, 'Actually make it 60% when studying');

    const { plan } = await activateStudy();
    expect(plan.actions.find((a) => a.capability === 'brightness')?.value).toBe(60);

    await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
    });
    expect(__getMockBrightnessPercent()).toBe(60);
  });

  it('a removed preference does not linger in a snapshot from an earlier context', async () => {
    const id = await rememberBrightness(TAUGHT_PERCENT, 'I prefer 25% when studying');
    __setMockBrightnessRaw(USER_RAW);

    const snapshots = createRepositorySnapshotStore();
    const first = await activateStudy();
    await startContext(first.plan, { registry: mockRegistry, snapshots });
    await endContext(first.plan.sessionId, { registry: mockRegistry, snapshots });
    expect(__getMockBrightnessRaw()).toBe(USER_RAW);

    await profileRepository.deletePreference(id);
    seededPreferences.length = 0;

    const second = await activateStudy();
    const secondSnapshots = createRepositorySnapshotStore();
    await startContext(second.plan, { registry: mockRegistry, snapshots: secondSnapshots });

    // The new context captured the user's CURRENT value and applied the default. Nothing from
    // the deleted preference survived in the snapshot table under the new session.
    const rows = await secondSnapshots.forSession(second.plan.sessionId);
    expect(rows.find((r) => r.capability === 'brightness')?.previousValue).toBe(73);
    expect(__getMockBrightnessPercent()).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// A4.6 — preference changes DURING an active context
// ---------------------------------------------------------------------------
//
// NOT IMPLEMENTED, DELIBERATELY. What should happen when a preference changes while a context is
// already running is not defined by any existing interface: `resolve()` is called from exactly
// one place, `activateFromText`, which also calls `startSession` — so resolution and starting a
// context are the same act, and there is no way to re-resolve against a session that is already
// running. The frozen SESSION_STATES even contains `OVERRIDING`, and nothing sets it.
//
// So this block does not invent the semantics. It pins down the GROUND those semantics would be
// built on: what the device layer does today, and the one trap waiting for whoever defines them.
// Every assertion here is current behaviour, not desired behaviour.

describe('A4.6 — the ground a mid-context change would be built on', () => {
  it("SAFE: re-applying within the SAME session keeps the user's original value", async () => {
    __setMockBrightnessRaw(USER_RAW);
    const snapshots = createRepositorySnapshotStore();
    const { plan } = await activateStudy();

    await startContext(plan, { registry: mockRegistry, snapshots });
    expect(__getMockBrightnessPercent()).toBe(40);

    // The change, expressed as a second run of the same session id. First-write-wins in the
    // SnapshotStore means the second capture is discarded, so what is owed back is still 187.
    const changed = { ...plan, actions: [{ ...plan.actions[1]!, value: 15 }] };
    await startContext(changed, { registry: mockRegistry, snapshots });
    expect(__getMockBrightnessPercent()).toBe(15);

    const rows = await snapshots.forSession(plan.sessionId);
    expect(rows.find((r) => r.capability === 'brightness')?.previousValue).toBe(73);

    await endContext(plan.sessionId, { registry: mockRegistry, snapshots });
    expect(__getMockBrightnessRaw()).toBe(USER_RAW);
  });

  it("THE TRAP: re-activating starts a SECOND session, which captures Ally's own values", async () => {
    __setMockBrightnessRaw(USER_RAW);
    const first = await activateStudy();
    const firstStore = createRepositorySnapshotStore();
    await startContext(first.plan, { registry: mockRegistry, snapshots: firstStore });
    expect(__getMockBrightnessPercent()).toBe(40);

    // Whoever implements A4.6 must NOT reach for activateFromText to express the change.
    const second = await activateStudy();
    expect(second.plan.sessionId).not.toBe(first.plan.sessionId);

    const secondStore = createRepositorySnapshotStore();
    await startContext(second.plan, { registry: mockRegistry, snapshots: secondStore });

    // 40 — the value ALLY set, now recorded as if it were the user's. Ending this session would
    // hand the user back a screen Ally dimmed and call it their own setting. The genuine original
    // is stranded on the first session, which nothing will ever end.
    const rows = await secondStore.forSession(second.plan.sessionId);
    expect(rows.find((r) => r.capability === 'brightness')?.previousValue).toBe(40);
    expect(rows.find((r) => r.capability === 'brightness')?.previousValue).not.toBe(73);

    // Cleanup: put the phone back through the session that actually holds the truth.
    await endContext(second.plan.sessionId, { registry: mockRegistry, snapshots: secondStore });
    await endContext(first.plan.sessionId, { registry: mockRegistry, snapshots: firstStore });
    expect(__getMockBrightnessRaw()).toBe(USER_RAW);
  });
});
