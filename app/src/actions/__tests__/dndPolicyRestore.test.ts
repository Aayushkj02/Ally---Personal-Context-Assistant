/**
 * OWNER: AAYUSH — durable DND notification policy (ADR-120)
 *
 * The notification policy is user state Ally borrows to express "let Mom call me", and it has
 * to come back. Two ways it used not to:
 *
 *   1. The saved copy lived in the heap, so a context that outlived its process could never be
 *      undone — and said nothing, because a null saved policy was a silent no-op.
 *   2. The restore was tied to `mode == "off"`, so a user who already had Do Not Disturb on got
 *      their mode back and silently kept Ally's policy.
 *
 * `MockDevice` models the five-field policy and keeps the saved copy across
 * `__simulateProcessDeath()`, exactly as SharedPreferences does, so both are testable with no
 * phone attached.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import type { ActionPlan, Capability, PlannedAction } from '../../types';
import {
  mockRegistry,
  __resetMockState,
  __setMockPermission,
  __getMockState,
  __getMockPolicy,
  __setMockPolicy,
  __getMockSavedPolicy,
  __applyMockPriorityPolicy,
  __simulateProcessDeath,
  type MockPolicy,
} from '../../native/MockDevice';
import { executePlan, restoreSession, createInMemorySnapshotStore } from '../index';

const SESSION = 'session-1';

/** A distinctive "user's own" policy — none of these are the values Ally writes. */
const USER_POLICY: MockPolicy = {
  priorityCategories: 0b100010,
  priorityCallSenders: 2,
  priorityMessageSenders: 1,
  suppressedVisualEffects: 511,
  priorityConversationSenders: 1,
};

function action(overrides: Partial<PlannedAction> & { capability: Capability }): PlannedAction {
  return {
    value: 'priority',
    needsSnapshot: true,
    requiredPermission: 'notification_policy',
    reason: 'test',
    ...overrides,
  };
}

function plan(actions: PlannedAction[]): ActionPlan {
  return { sessionId: SESSION, actions, restoreOnEnd: true };
}

/** Start a context that changes DND and applies a priority policy, as A-V7 does. */
async function startPriorityContext(snapshots = createInMemorySnapshotStore()) {
  await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), {
    registry: mockRegistry,
    snapshots,
  });
  __applyMockPriorityPolicy(true, false);
  return snapshots;
}

beforeEach(() => {
  __resetMockState();
  __setMockPolicy(USER_POLICY);
});

// ---------------------------------------------------------------------------
// 1-3. Capture
// ---------------------------------------------------------------------------

describe('1-3. saving the original policy', () => {
  it('saves the user policy before Ally overwrites it', async () => {
    await startPriorityContext();

    expect(__getMockSavedPolicy()).toEqual(USER_POLICY);
    // And the live policy really is Ally's now, not the user's.
    expect(__getMockPolicy()).not.toEqual(USER_POLICY);
  });

  it('saves ALL FIVE fields, not just the three Ally writes', async () => {
    await startPriorityContext();

    expect(Object.keys(__getMockSavedPolicy() ?? {}).sort()).toEqual([
      'priorityCallSenders',
      'priorityCategories',
      'priorityConversationSenders',
      'priorityMessageSenders',
      'suppressedVisualEffects',
    ]);
  });

  it("Ally's write really does discard the two fields it never sets", async () => {
    await startPriorityContext();

    // This is why three fields would not be enough: the 3-argument constructor zeroes these,
    // so they are borrowed state whether Ally meant to touch them or not.
    expect(USER_POLICY.suppressedVisualEffects).toBe(511);
    expect(__getMockPolicy().suppressedVisualEffects).toBe(0);
    expect(__getMockPolicy().priorityConversationSenders).toBe(0);
  });

  it('FIRST WRITE WINS — a second apply never overwrites the original', async () => {
    await startPriorityContext();
    __applyMockPriorityPolicy(true, true); // context changes its mind

    // Still the user's policy, not the first one Ally set.
    expect(__getMockSavedPolicy()).toEqual(USER_POLICY);
  });
});

// ---------------------------------------------------------------------------
// 4. Exact restore of all five fields
// ---------------------------------------------------------------------------

describe('4. exact restore', () => {
  it('puts every one of the five fields back', async () => {
    const snapshots = await startPriorityContext();

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(__getMockPolicy()).toEqual(USER_POLICY);
  });
});

// ---------------------------------------------------------------------------
// 5. The mode == "off" bug
// ---------------------------------------------------------------------------

describe('5. original DND already ON', () => {
  it('restores the policy even when the mode being returned to is not off', async () => {
    // The user was already on priority before Ally started.
    const snapshots = createInMemorySnapshotStore();
    await executePlan(plan([action({ capability: 'dnd', value: 'total_silence' })]), {
      registry: mockRegistry,
      snapshots,
    });
    __applyMockPriorityPolicy(true, false);

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    // Mode goes back to what it was...
    expect(__getMockState().dnd).toBe('off');
    // ...and so does the policy. Tying the restore to mode == "off" is what used to leave
    // Ally's policy on the phone forever in this case.
    expect(__getMockPolicy()).toEqual(USER_POLICY);
  });

  it('restores the policy when the user started on priority and returns to priority', async () => {
    const snapshots = createInMemorySnapshotStore();
    // Put the device on priority first so the snapshot captures 'priority', not 'off'.
    await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots: createInMemorySnapshotStore(),
    });

    await executePlan(plan([action({ capability: 'dnd', value: 'total_silence' })]), {
      registry: mockRegistry,
      snapshots,
    });
    __applyMockPriorityPolicy(true, false);

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(__getMockState().dnd).toBe('priority');
    expect(__getMockPolicy()).toEqual(USER_POLICY);
  });
});

// ---------------------------------------------------------------------------
// 6. Process death — the headline
// ---------------------------------------------------------------------------

describe('6. process death', () => {
  it('restores the exact original policy after the app has died and come back', async () => {
    const snapshots = await startPriorityContext();
    expect(__getMockPolicy()).not.toEqual(USER_POLICY);

    // The app is killed and reopened. The phone keeps its policy; Ally keeps its saved copy
    // only because that copy is on disk.
    __simulateProcessDeath();
    expect(__getMockSavedPolicy()).toEqual(USER_POLICY);

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(__getMockPolicy()).toEqual(USER_POLICY);
  });
});

// ---------------------------------------------------------------------------
// 7-11. Missing, failing, clearing, retrying
// ---------------------------------------------------------------------------

describe('7-11. saved-policy lifecycle', () => {
  it('a context that never touched priority has nothing to restore, and that is fine', async () => {
    const snapshots = createInMemorySnapshotStore();
    await executePlan(plan([action({ capability: 'dnd', value: 'priority' })]), {
      registry: mockRegistry,
      snapshots,
    });

    expect(__getMockSavedPolicy()).toBeNull();

    const results = await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(results[0]?.status).toBe('restored');
    expect(__getMockPolicy()).toEqual(USER_POLICY); // untouched throughout
  });

  it('a successful restore CLEARS the saved policy', async () => {
    const snapshots = await startPriorityContext();

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(__getMockSavedPolicy()).toBeNull();
  });

  it('a failed restore RETAINS the saved policy for a retry', async () => {
    const snapshots = await startPriorityContext();
    __setMockPermission('notification_policy', false);

    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    // Nothing went back, and the original is still held — losing it here would strand the
    // user with Ally's policy and no way home.
    expect(__getMockSavedPolicy()).toEqual(USER_POLICY);
    expect(__getMockPolicy()).not.toEqual(USER_POLICY);
  });

  it('a retry after the permission returns finishes the job exactly', async () => {
    const snapshots = await startPriorityContext();

    __setMockPermission('notification_policy', false);
    await restoreSession(SESSION, { registry: mockRegistry, snapshots });
    expect(__getMockPolicy()).not.toEqual(USER_POLICY);

    __setMockPermission('notification_policy', true);
    await restoreSession(SESSION, { registry: mockRegistry, snapshots });

    expect(__getMockPolicy()).toEqual(USER_POLICY);
    expect(__getMockSavedPolicy()).toBeNull();
  });

  it('the NEXT context captures a fresh original after a clean restore', async () => {
    const first = await startPriorityContext();
    await restoreSession(SESSION, { registry: mockRegistry, snapshots: first });

    // The user changes their own policy between contexts.
    const changed: MockPolicy = {
      ...USER_POLICY,
      priorityCategories: 0b1000,
      suppressedVisualEffects: 7,
    };
    __setMockPolicy(changed);

    await startPriorityContext(createInMemorySnapshotStore());

    // The new context borrowed the NEW value, not the stale one from last time.
    expect(__getMockSavedPolicy()).toEqual(changed);
  });
});
