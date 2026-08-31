/**
 * OWNER: AAYUSH — Phase 4 (A4.4, A4.5)
 *
 * A remembered "let Mom call me" followed to the notification policy and back.
 *
 * SAME SHAPE AS learnedPreferences.test.ts, different half of the product: Dhrey's
 * priorityRepository stores the rows, his resolver reduces them to per-channel booleans, his
 * applier sends what Android can take, and the lifecycle decides WHEN — after the plan, never
 * when the plan applied nothing (ADR-119). Only the phone is swapped for MockDevice.
 *
 * PRIORITY DOES NOT TRAVEL AS A PlannedAction, and that is deliberate rather than an omission.
 * Android has no per-contact Do Not Disturb exception, so "Mom can call" is not a capability
 * value — it is a rewrite of NotificationManager.Policy, which the frozen `CAPABILITIES` list has
 * no member for. It reaches the device through the coordinator's injected `applyPriority` thunk.
 * These tests exercise that real seam rather than restructuring it.
 *
 * THE ENFORCEMENT LADDER IS THE POINT (ADR-111/113):
 *
 *   calls     Android enforces  → `enforced`
 *   sms       Android enforces  → `enforced`
 *   whatsapp  no public API     → `preference_only`, remembered and never claimed
 *
 * The applier below is a TEST DOUBLE for DndController.setPriority, not a second implementation
 * of it: it drives the mock's five-field policy and reports the same per-channel rows. What the
 * real Kotlin does is proven on the Samsung, not here.
 */

import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';

import { ensureSeeded, priorityRepository, loadProfileContext } from '../../memory';
import { getDatabase } from '../../memory/database';
import { activateFromText } from '../../services/contextOrchestrator';
import { applyPriorityForActivity, type PriorityApplier } from '../../services/priorityIntegration';
import { FallbackParser } from '../../ai/parsers';
import { IntentValidator } from '../../ai/validators';
import type { ChannelEnforcement, ParseResult } from '../../types';
import type { ActivationOutcome } from '../../services/contextOrchestrator';
import {
  mockRegistry,
  mockBorrowedPolicy,
  __resetMockState,
  __setMockBrightnessRaw,
  __getMockPolicy,
  __getMockSavedPolicy,
  __applyMockPriorityPolicy,
  __setMockPolicy,
  __setMockPermission,
  __simulateProcessDeath,
} from '../../native/MockDevice';
import { startContext, endContext, createRepositorySnapshotStore } from '../index';

const STUDY_PROFILE = 'profile_study';
const STUDY_SENTENCE = "I'm going to study for two hours.";
const USER_RAW = 187;

const offlineEngine = {
  async parse(text: string): Promise<ParseResult> {
    const result = await new FallbackParser().parse(text);
    return IntentValidator.validate(result as ParseResult);
  },
};

/**
 * Stands in for DndController.setPriority: writes the mock's policy and reports per channel.
 *
 * `whatsapp` is absent from the argument by construction — `PriorityRequest` has no such field
 * (ADR-111), so there is no expression here that could ask Android for it. The row below is added
 * as `preference_only` because that is the truth, not because this double chose to be cautious.
 */
const deviceApplier: PriorityApplier = ({ calls, sms }) => {
  __applyMockPriorityPolicy(calls, sms);
  const policy = __getMockPolicy();

  const callsHeld = !calls || (policy.priorityCategories & 0b1) !== 0;
  const smsHeld = !sms || (policy.priorityCategories & 0b100) !== 0;

  const channels: ChannelEnforcement[] = [
    {
      channel: 'calls',
      status: !calls ? 'unsupported' : callsHeld ? 'enforced' : 'failed',
      message: !calls ? 'Priority calls were not requested.' : 'Starred contacts can call you.',
    },
    {
      channel: 'sms',
      status: !sms ? 'unsupported' : smsHeld ? 'enforced' : 'failed',
      message: !sms ? 'Priority messages were not requested.' : 'Starred contacts can message you.',
    },
    {
      channel: 'whatsapp',
      status: 'preference_only',
      message: 'Ally remembers this. Android cannot let Ally control WhatsApp notifications.',
    },
  ];

  return { ok: callsHeld && smsHeld, channels };
};

/** The seam the coordinator is given, wired exactly as App.tsx wires it. */
const applyPriority = async (): Promise<ChannelEnforcement[] | null> => {
  const outcome = await applyPriorityForActivity('study', { applier: deviceApplier });
  return outcome?.enforcement ?? null;
};

async function activateStudy(): Promise<Extract<ActivationOutcome, { kind: 'activated' }>> {
  const outcome = await activateFromText(STUDY_SENTENCE, { engine: offlineEngine });
  if (outcome.kind !== 'activated') throw new Error('expected an activation');
  return outcome;
}

/** Stores a standing "X can reach me on this channel during Study". Dhrey's API, unmodified. */
async function remember(channel: 'calls' | 'sms' | 'whatsapp', subject = 'Mom') {
  return priorityRepository.addPreference({
    profileId: STUDY_PROFILE,
    channel,
    subject,
    sourceCommand: `Always let ${subject} reach me on ${channel} while I study`,
  });
}

beforeAll(async () => {
  await getDatabase();
  await ensureSeeded();
});

afterEach(async () => {
  await priorityRepository.clearProfile(STUDY_PROFILE);
  __resetMockState();
});

// ---------------------------------------------------------------------------
// A4.4 — stored priority reaches Android, honestly, per channel
// ---------------------------------------------------------------------------

describe('A4.4 — a remembered priority contact reaches the device', () => {
  it('a stored calls preference is enforced on the device policy', async () => {
    await remember('calls');
    __setMockBrightnessRaw(USER_RAW);

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    const byChannel = new Map(r.priority?.map((c) => [c.channel, c.status]));
    expect(byChannel.get('calls')).toBe('enforced');
    // The device really was changed, not just reported on.
    expect(__getMockPolicy().priorityCategories & 0b1).not.toBe(0);
  });

  it('a stored sms preference is enforced, and calls stay out when not asked for', async () => {
    await remember('sms');

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    const byChannel = new Map(r.priority?.map((c) => [c.channel, c.status]));
    expect(byChannel.get('sms')).toBe('enforced');
    expect(byChannel.get('calls')).toBe('unsupported'); // not requested, not failed
    expect(__getMockPolicy().priorityCategories & 0b100).not.toBe(0);
    expect(__getMockPolicy().priorityCategories & 0b1).toBe(0);
  });

  it('WhatsApp is remembered and never claimed as enforced', async () => {
    await remember('whatsapp');

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    const whatsapp = r.priority?.find((c) => c.channel === 'whatsapp');
    expect(whatsapp?.status).toBe('preference_only');
    expect(whatsapp?.status).not.toBe('enforced');

    // And the row survives in memory, because "remembered" has to mean something.
    const stored = await priorityRepository.listForProfile(STUDY_PROFILE);
    expect(stored.find((p) => p.channel === 'whatsapp')?.enforceable).toBe(false);
  });

  it('all three channels at once keep three different answers', async () => {
    await remember('calls');
    await remember('sms');
    await remember('whatsapp');

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    expect(r.priority?.map((c) => [c.channel, c.status])).toEqual([
      ['calls', 'enforced'],
      ['sms', 'enforced'],
      ['whatsapp', 'preference_only'],
    ]);
  });

  it('priority never collapses into the plan status — the context is still ACTIVE', async () => {
    await remember('whatsapp');

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    // "Your WhatsApp preference is remembered but Android will not act on it" and "the context
    // is running" are different facts, and the user needs both (ADR-113).
    expect(r.state).toBe('ACTIVE');
  });

  it('a preference the user turned off is not sent to the device', async () => {
    const pref = await remember('calls');
    await priorityRepository.setEnabled(pref.id, false);

    const context = await loadProfileContext('study');
    expect(context!.priorityPreferences.find((p) => p.id === pref.id)?.enabled).toBe(false);

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    expect(r.priority?.find((c) => c.channel === 'calls')?.status).toBe('unsupported');
    expect(__getMockPolicy().priorityCategories & 0b1).toBe(0);
  });

  it('a removed preference stops changing the device on the next context', async () => {
    const pref = await remember('calls');

    const first = await activateStudy();
    await startContext(first.plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });
    expect(__getMockPolicy().priorityCategories & 0b1).not.toBe(0);

    await priorityRepository.removePreference(pref.id);
    __resetMockState();

    const second = await activateStudy();
    const r = await startContext(second.plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    expect(r.priority?.find((c) => c.channel === 'calls')?.status).toBe('unsupported');
    expect(__getMockPolicy().priorityCategories & 0b1).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A4.5 — the policy priority borrowed is given back, durably
// ---------------------------------------------------------------------------

describe('A4.5 — durable restoration of the policy priority rewrote', () => {
  it('captures the user policy before the stored preference overwrites it', async () => {
    const original = __getMockPolicy();
    await remember('calls');

    const { plan } = await activateStudy();
    await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    expect(__getMockPolicy()).not.toEqual(original);
    // First write wins: what is saved is what the user had, never what Ally set.
    expect(__getMockSavedPolicy()).toEqual(original);
  });

  it('gives all five fields back when the context ends', async () => {
    const original = __getMockPolicy();
    await remember('calls');
    __setMockBrightnessRaw(USER_RAW);

    const snapshots = createRepositorySnapshotStore();
    const { plan } = await activateStudy();
    await startContext(plan, { registry: mockRegistry, snapshots, applyPriority });

    const end = await endContext(plan.sessionId, {
      registry: mockRegistry,
      snapshots,
      policy: mockBorrowedPolicy,
    });

    expect(end.state).toBe('IDLE');
    // Not three of five. Ally's write replaces suppressedVisualEffects and
    // priorityConversationSenders with constructor defaults, so those are borrowed too.
    expect(__getMockPolicy()).toEqual(original);
    expect(__getMockSavedPolicy()).toBeNull();
  });

  it('survives a process death — the saved copy is not in the heap', async () => {
    const original = __getMockPolicy();
    await remember('calls');
    await remember('sms');
    __setMockBrightnessRaw(USER_RAW);

    const { plan } = await activateStudy();
    await startContext(plan, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    __simulateProcessDeath();

    // A fresh store and nothing else in hand but the session id — the A-V2 shape.
    const end = await endContext(plan.sessionId, {
      registry: mockRegistry,
      snapshots: createRepositorySnapshotStore(),
      policy: mockBorrowedPolicy,
    });

    expect(end.state).toBe('IDLE');
    expect(__getMockPolicy()).toEqual(original);
  });

  it('a user who already had a custom policy gets THEIR policy back, not a default', async () => {
    // Nothing generic is ever restored. This is a policy no default would produce.
    const custom = {
      priorityCategories: 0b101010,
      priorityCallSenders: 1,
      priorityMessageSenders: 0,
      suppressedVisualEffects: 63,
      priorityConversationSenders: 2,
    };
    __setMockPolicy(custom);

    await remember('calls');
    const snapshots = createRepositorySnapshotStore();
    const { plan } = await activateStudy();
    await startContext(plan, { registry: mockRegistry, snapshots, applyPriority });
    expect(__getMockPolicy()).not.toEqual(custom);

    await endContext(plan.sessionId, {
      registry: mockRegistry,
      snapshots,
      policy: mockBorrowedPolicy,
    });

    expect(__getMockPolicy()).toEqual(custom);
  });

  it('a failed restore keeps the saved policy, so the retry still has it', async () => {
    const original = __getMockPolicy();
    await remember('calls');

    const snapshots = createRepositorySnapshotStore();
    const { plan } = await activateStudy();
    await startContext(plan, { registry: mockRegistry, snapshots, applyPriority });

    __setMockPermission('notification_policy', false);

    const blocked = await endContext(plan.sessionId, {
      registry: mockRegistry,
      snapshots,
      policy: mockBorrowedPolicy,
    });
    expect(blocked.state).toBe('PARTIAL');
    expect(blocked.retryable).toBe(true);
    expect(__getMockSavedPolicy()).not.toBeNull();

    __setMockPermission('notification_policy', true);
    const retry = await endContext(plan.sessionId, {
      registry: mockRegistry,
      snapshots,
      policy: mockBorrowedPolicy,
    });

    expect(retry.state).toBe('IDLE');
    expect(__getMockPolicy()).toEqual(original);
  });

  it('a context that applied nothing never rewrites the policy', async () => {
    const original = __getMockPolicy();
    await remember('calls');

    const { plan } = await activateStudy();
    const r = await startContext(plan, {
      registry: {
        backend: 'mock',
        get() {
          throw new Error('no capability');
        },
        async openSettingsFor() {},
      },
      snapshots: createRepositorySnapshotStore(),
      applyPriority,
    });

    // Nothing moved on the phone, so letting people through a context that never started would
    // rewrite the user's notification policy for nothing.
    expect(r.state).toBe('ERROR');
    expect(r.priority).toBeNull();
    expect(__getMockPolicy()).toEqual(original);
    expect(__getMockSavedPolicy()).toBeNull();
  });
});
