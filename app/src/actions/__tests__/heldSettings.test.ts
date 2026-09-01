/**
 * OWNER: AAYUSH — Phase 6 (A6.1 / A6.7)
 *
 * REGRESSION TESTS FOR A BUG FOUND ON THE SAMSUNG, NOT IN A TEST RUN.
 *
 * On SM-S928B: start Study, kill Ally, reopen it. The session and countdown came back; the results
 * did not, because they live in React state. Active Context then rendered "0/0 changes applied"
 * and "Nothing yet" over a phone that was genuinely at DND=priority and brightness 64/255.
 *
 * The tests below pin the three statements that must stay distinguishable, because collapsing any
 * two of them is how that bug gets back in:
 *
 *   1. Ally is holding nothing.
 *   2. Ally is holding these specific settings.
 *   3. Ally cannot tell you what it is holding.
 */

import { describe, it, expect } from '@jest/globals';

import type { Capability, CapabilityValue, DeviceSnapshot } from '../../types';
import {
  heldForSession,
  describeHeld,
  createInMemorySnapshotStore,
  buildSnapshot,
  type SnapshotStore,
} from '../index';

const SESSION = 'sess_held';

async function storeWith(
  rows: { capability: Capability; previous: CapabilityValue | null }[],
): Promise<SnapshotStore> {
  const store = createInMemorySnapshotStore();
  for (const r of rows) {
    await store.save(buildSnapshot(SESSION, r.capability, r.previous, Date.now()));
  }
  return store;
}

// ---------------------------------------------------------------------------
// The recovered case — the actual bug
// ---------------------------------------------------------------------------

describe('A6.1 — what Ally is holding survives a process death', () => {
  it('reports the capabilities the snapshots recorded', async () => {
    const store = await storeWith([
      { capability: 'dnd', previous: 'off' },
      { capability: 'brightness', previous: 187 },
    ]);

    const outcome = await heldForSession(SESSION, store);

    expect(outcome.readable).toBe(true);
    expect(outcome.settings.map((s) => s.capability).sort()).toEqual(['brightness', 'dnd']);
  });

  it("carries the user's OWN value, which is what restore puts back", async () => {
    // 187 is the value measured on the Samsung before Ally touched it. If this ever became the
    // value Ally set, restore would hand the user Ally's own change back (the ADR-110 bug).
    const store = await storeWith([{ capability: 'brightness', previous: 187 }]);

    const outcome = await heldForSession(SESSION, store);
    expect(outcome.settings[0]?.previousValue).toBe(187);
  });

  it('says what it is holding instead of "Nothing yet"', async () => {
    const store = await storeWith([
      { capability: 'dnd', previous: 'off' },
      { capability: 'brightness', previous: 187 },
    ]);

    const sentence = describeHeld(await heldForSession(SESSION, store));

    expect(sentence).toContain('dnd');
    expect(sentence).toContain('brightness');
    // The exact wording that was on screen over a held phone.
    expect(sentence).not.toMatch(/nothing yet/i);
    expect(sentence).toMatch(/end the context|go back when you end/i);
  });

  it('does not leak another session’s holdings', async () => {
    const store = createInMemorySnapshotStore();
    await store.save(buildSnapshot(SESSION, 'dnd', 'off', Date.now()));
    await store.save(buildSnapshot('sess_other', 'brightness', 40, Date.now()));

    const outcome = await heldForSession(SESSION, store);
    expect(outcome.settings).toHaveLength(1);
    expect(outcome.settings[0]?.capability).toBe('dnd');
  });
});

// ---------------------------------------------------------------------------
// Holding nothing is a real answer, and a different one
// ---------------------------------------------------------------------------

describe('A6.1 — an empty session is stated as empty', () => {
  it('is readable with no settings, not unreadable', async () => {
    const outcome = await heldForSession(SESSION, createInMemorySnapshotStore());

    expect(outcome.readable).toBe(true);
    expect(outcome.settings).toEqual([]);
    expect(describeHeld(outcome)).toMatch(/not holding any/i);
  });
});

// ---------------------------------------------------------------------------
// The failure that must never be worded as "nothing"
// ---------------------------------------------------------------------------

describe('A6.7 — an unreadable store says so', () => {
  const broken: SnapshotStore = {
    save: async () => {},
    forSession: () => Promise.reject(new Error('database is locked')),
    clear: async () => {},
  };

  it('returns readable:false rather than throwing into a screen refresh', async () => {
    await expect(heldForSession(SESSION, broken)).resolves.toEqual({
      readable: false,
      settings: [],
    });
  });

  it('never tells the user their phone is free when Ally cannot check', async () => {
    const sentence = describeHeld(await heldForSession(SESSION, broken));

    // The dangerous sentence is "not holding anything" — it invites the user to walk away from a
    // dimmed, silenced phone. An unreadable store must produce the opposite instruction.
    expect(sentence).not.toMatch(/not holding any/i);
    expect(sentence).toMatch(/cannot read/i);
    expect(sentence).toMatch(/end the context/i);
  });

  it('exposes no stack trace or driver text (A6.7)', async () => {
    const sentence = describeHeld(await heldForSession(SESSION, broken));

    expect(sentence).not.toMatch(/database is locked/);
    expect(sentence).not.toMatch(/Error|at\s+\w+\./);
  });
});

// ---------------------------------------------------------------------------
// Boundary: this is not an execution result
// ---------------------------------------------------------------------------

describe('A6.1 — held is not the same claim as applied', () => {
  it('produces no ActionStatus, so nothing can be rendered as "Applied"', async () => {
    const store = await storeWith([{ capability: 'dnd', previous: 'off' }]);
    const outcome = await heldForSession(SESSION, store);

    // A snapshot proves Ally captured the user's value. It does NOT prove Ally's own change
    // succeeded — a capability can snapshot and then fail. Manufacturing an `applied` here would
    // be precisely the fabrication the status vocabulary exists to prevent.
    const row = outcome.settings[0] as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty('status');
    expect(Object.keys(row).sort()).toEqual(['capability', 'previousValue']);
  });

  it('a snapshot with an unreadable previous value is still reported as held', async () => {
    // Null means "we could not read your value", not "there was nothing to hold". The capability
    // was still touched and the user still needs to know.
    const store = await storeWith([{ capability: 'ringer', previous: null }]);
    const outcome = await heldForSession(SESSION, store);

    expect(outcome.settings).toHaveLength(1);
    expect(outcome.settings[0]?.previousValue).toBeNull();
    expect(describeHeld(outcome)).toContain('ringer');
  });
});

// ---------------------------------------------------------------------------
// Shape check against the frozen model
// ---------------------------------------------------------------------------

describe('A6.1 — reads the frozen DeviceSnapshot, defines no second model', () => {
  it('uses buildSnapshot rows unchanged', async () => {
    const row: DeviceSnapshot = buildSnapshot(SESSION, 'dnd', 'off', 1_700_000_000_000);
    const store = createInMemorySnapshotStore();
    await store.save(row);

    const outcome = await heldForSession(SESSION, store);
    expect(outcome.settings[0]).toEqual({
      capability: row.capability,
      previousValue: row.previousValue,
    });
  });
});
