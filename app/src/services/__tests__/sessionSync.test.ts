/**
 * OWNER: DHREY — task D-V10 (Session Sync / Bridge)
 *
 * Tests the fire-and-forget POST /session client (sessionSync.ts).
 *
 * Every test uses a mock fetch — no real HTTP, no real bridge server. The
 * production contract is that a dead bridge is invisible; the tests verify
 * that the client honours that by swallowing errors silently and never
 * throwing.
 *
 * DOES NOT test:
 *   - Shlok's bridgeClient.ts (POST /parse, GET /health) — different owner
 *   - The actual laptop bridge server — lives in bridge/src/server/
 *   - Policy resolution, database I/O, or native capabilities
 */

import {
  SessionSyncClient,
  isValidSyncMessage,
  SESSION_EVENTS,
  type SessionSyncMessage,
  type SessionEvent,
} from '../sessionSync';
import type { ActionPlan, ActionResult, SessionState } from '../../types/policy';

// ---------------------------------------------------------------------------
// Shared fixtures — reuse the frozen contracts verbatim
// ---------------------------------------------------------------------------

const PROFILE_ID = 'profile_study';
const SESSION_ID = 'sess_dv10_test';

const PLAN: ActionPlan = {
  sessionId: SESSION_ID,
  restoreOnEnd: true,
  actions: [
    {
      capability: 'dnd',
      value: 'priority',
      needsSnapshot: true,
      requiredPermission: 'notification_policy',
      reason: 'from your Study profile',
    },
    {
      capability: 'brightness',
      value: 40,
      needsSnapshot: true,
      requiredPermission: 'write_settings',
      reason: 'from system defaults',
    },
  ],
};

const RESULTS: ActionResult[] = [
  {
    capability: 'dnd',
    status: 'applied',
    beforeValue: 'off',
    afterValue: 'priority',
    message: 'DND set to priority.',
  },
  {
    capability: 'brightness',
    status: 'applied',
    beforeValue: 80,
    afterValue: 40,
    message: 'Brightness set to 40%.',
  },
];

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

let fetchMock: jest.SpyInstance;
let lastFetchBody: SessionSyncMessage | null;

function installFetch(
  response: { ok: boolean; status: number } = { ok: true, status: 204 },
): void {
  lastFetchBody = null;
  fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.body) {
      lastFetchBody = JSON.parse(init.body as string) as SessionSyncMessage;
    }
    return { ok: response.ok, status: response.status } as Response;
  });
}

function installFetchFailure(): void {
  lastFetchBody = null;
  fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Network unreachable');
  });
}

function installHealthThenSession(healthOk: boolean): void {
  lastFetchBody = null;
  fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const urlStr = typeof url === 'string' ? url : (url as Request).url;
    if (urlStr.endsWith('/health')) {
      return { ok: healthOk, status: healthOk ? 200 : 503 } as Response;
    }
    if (init?.body) {
      lastFetchBody = JSON.parse(init.body as string) as SessionSyncMessage;
    }
    return { ok: true, status: 204 } as Response;
  });
}

afterEach(() => {
  fetchMock?.mockRestore();
});

// ===========================================================================
// TESTS
// ===========================================================================

describe('D-V10 Session Sync / Bridge', () => {
  // ── TEST 1 — Bridge initialisation ──────────────────────────────────────
  it('DV10-1: initialises with sensible defaults', () => {
    const client = new SessionSyncClient();
    expect(client.connectionState).toBe('disconnected');

    const custom = new SessionSyncClient({
      baseUrl: 'http://10.0.0.1:4000',
      timeoutMs: 5000,
    });
    expect(custom.connectionState).toBe('disconnected');
  });

  // ── TEST 2 — Connection lifecycle ───────────────────────────────────────
  it('DV10-2a: checkConnection succeeds when /health returns ok', async () => {
    installHealthThenSession(true);
    const client = new SessionSyncClient();

    const ok = await client.checkConnection();
    expect(ok).toBe(true);
    expect(client.connectionState).toBe('connected');
  });

  it('DV10-2b: checkConnection fails gracefully when /health is down', async () => {
    installFetchFailure();
    const client = new SessionSyncClient();

    const ok = await client.checkConnection();
    expect(ok).toBe(false);
    expect(client.connectionState).toBe('disconnected');
  });

  it('DV10-2c: disconnect() resets to disconnected', async () => {
    installHealthThenSession(true);
    const client = new SessionSyncClient();
    await client.checkConnection();
    expect(client.connectionState).toBe('connected');

    client.disconnect();
    expect(client.connectionState).toBe('disconnected');
  });

  // ── TEST 3 — Session synchronisation ────────────────────────────────────
  it('DV10-3: syncSessionStarted sends the correct message shape', async () => {
    installFetch();
    const client = new SessionSyncClient();

    await client.syncSessionStarted(SESSION_ID, PROFILE_ID, 'READY', 120);

    expect(lastFetchBody).not.toBeNull();
    expect(lastFetchBody!.event).toBe('session_started');
    expect(lastFetchBody!.sessionId).toBe(SESSION_ID);
    expect(lastFetchBody!.payload).toEqual({
      activeProfileId: PROFILE_ID,
      sessionState: 'READY',
      durationMinutes: 120,
    });
  });

  it('DV10-3b: syncStateChanged carries activeProfileId and sessionState', async () => {
    installFetch();
    const client = new SessionSyncClient();

    await client.syncStateChanged(SESSION_ID, PROFILE_ID, 'ACTIVE');

    expect(lastFetchBody).not.toBeNull();
    expect(lastFetchBody!.event).toBe('session_state_changed');
    expect(lastFetchBody!.sessionId).toBe(SESSION_ID);
    expect(lastFetchBody!.payload).toEqual({
      activeProfileId: PROFILE_ID,
      sessionState: 'ACTIVE',
    });
  });

  // ── TEST 4 — ActionPlan transmission ────────────────────────────────────
  it('DV10-4: syncPlanSubmitted serialises the ActionPlan without modification', async () => {
    installFetch();
    const client = new SessionSyncClient();
    const snapshot = JSON.parse(JSON.stringify(PLAN));

    await client.syncPlanSubmitted(SESSION_ID, PROFILE_ID, PLAN);

    expect(lastFetchBody).not.toBeNull();
    expect(lastFetchBody!.event).toBe('plan_submitted');
    expect(lastFetchBody!.sessionId).toBe(SESSION_ID);

    const payload = lastFetchBody!.payload as { activeProfileId: string; plan: ActionPlan };
    expect(payload.activeProfileId).toBe(PROFILE_ID);
    // The plan is byte-identical: no fields added, removed, or changed.
    expect(payload.plan).toEqual(snapshot);
    expect(payload.plan.actions).toHaveLength(2);
    expect(payload.plan.actions[0]!.capability).toBe('dnd');
    expect(payload.plan.actions[0]!.value).toBe('priority');
    expect(payload.plan.actions[1]!.capability).toBe('brightness');
    expect(payload.plan.actions[1]!.value).toBe(40);
    // The original was not mutated.
    expect(PLAN).toEqual(snapshot);
  });

  // ── TEST 5 — ActionResult reception ─────────────────────────────────────
  it('DV10-5: syncResultsReceived transmits results with the frozen ActionStatus vocabulary', async () => {
    installFetch();
    const client = new SessionSyncClient();

    await client.syncResultsReceived(SESSION_ID, RESULTS);

    expect(lastFetchBody).not.toBeNull();
    expect(lastFetchBody!.event).toBe('results_received');

    const payload = lastFetchBody!.payload as { results: ActionResult[] };
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]!.status).toBe('applied');
    expect(payload.results[0]!.capability).toBe('dnd');
    expect(payload.results[1]!.status).toBe('applied');
    expect(payload.results[1]!.capability).toBe('brightness');
  });

  // ── TEST 6 — Invalid message ────────────────────────────────────────────
  it('DV10-6: isValidSyncMessage rejects malformed data', () => {
    expect(isValidSyncMessage(null)).toBe(false);
    expect(isValidSyncMessage(undefined)).toBe(false);
    expect(isValidSyncMessage(42)).toBe(false);
    expect(isValidSyncMessage('hello')).toBe(false);
    expect(isValidSyncMessage({})).toBe(false);
    expect(isValidSyncMessage({ event: 'session_started' })).toBe(false);
    expect(isValidSyncMessage({ event: 'session_started', sessionId: '' })).toBe(false);
    expect(isValidSyncMessage({ event: 'session_started', sessionId: 'x' })).toBe(false);
    expect(
      isValidSyncMessage({ event: 'session_started', sessionId: 'x', payload: null }),
    ).toBe(false);

    // Valid message should pass:
    expect(
      isValidSyncMessage({
        event: 'session_started',
        sessionId: 'x',
        payload: { activeProfileId: 'p', sessionState: 'READY', durationMinutes: null },
      }),
    ).toBe(true);
  });

  // ── TEST 7 — Unknown message type ───────────────────────────────────────
  it('DV10-7: isValidSyncMessage rejects unknown event types', () => {
    expect(
      isValidSyncMessage({
        event: 'session_exploded',
        sessionId: 'x',
        payload: {},
      }),
    ).toBe(false);

    expect(
      isValidSyncMessage({
        event: 'plan_submitted',
        sessionId: 'x',
        payload: { plan: PLAN },
      }),
    ).toBe(true);
  });

  // ── TEST 8 — Transport failure ──────────────────────────────────────────
  it('DV10-8a: transport failure on POST /session is swallowed — no throw', async () => {
    installFetchFailure();
    const client = new SessionSyncClient();

    // Must NOT throw.
    await expect(
      client.syncSessionStarted(SESSION_ID, PROFILE_ID, 'READY', 120),
    ).resolves.toBeUndefined();

    await expect(
      client.syncPlanSubmitted(SESSION_ID, PROFILE_ID, PLAN),
    ).resolves.toBeUndefined();

    await expect(
      client.syncResultsReceived(SESSION_ID, RESULTS),
    ).resolves.toBeUndefined();

    await expect(
      client.syncSessionEnded(SESSION_ID, 'IDLE'),
    ).resolves.toBeUndefined();

    expect(client.connectionState).toBe('disconnected');
  });

  it('DV10-8b: a non-2xx response is treated as error, not a crash', async () => {
    installFetch({ ok: false, status: 500 });
    const client = new SessionSyncClient();

    await expect(
      client.syncSessionStarted(SESSION_ID, PROFILE_ID, 'READY', 120),
    ).resolves.toBeUndefined();

    expect(client.connectionState).toBe('error');
  });

  // ── TEST 9 — Resynchronisation ──────────────────────────────────────────
  it('DV10-9: resync sends current runtime state to the bridge', async () => {
    const calls: SessionSyncMessage[] = [];
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.body) {
        calls.push(JSON.parse(init.body as string) as SessionSyncMessage);
      }
      return { ok: true, status: 204 } as Response;
    });

    const client = new SessionSyncClient();

    await client.resync({
      sessionId: SESSION_ID,
      activeProfileId: PROFILE_ID,
      sessionState: 'ACTIVE',
      plan: PLAN,
      results: RESULTS,
    });

    // State first, then plan, then results.
    expect(calls).toHaveLength(3);
    expect(calls[0]!.event).toBe('session_state_changed');
    expect(calls[1]!.event).toBe('plan_submitted');
    expect(calls[2]!.event).toBe('results_received');
  });

  it('DV10-9b: resync with no plan and no results sends only state', async () => {
    const calls: SessionSyncMessage[] = [];
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.body) {
        calls.push(JSON.parse(init.body as string) as SessionSyncMessage);
      }
      return { ok: true, status: 204 } as Response;
    });

    const client = new SessionSyncClient();

    await client.resync({
      sessionId: SESSION_ID,
      activeProfileId: null,
      sessionState: 'IDLE',
      plan: null,
      results: [],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.event).toBe('session_state_changed');
  });

  // ── TEST 10 — D-V6 regression ──────────────────────────────────────────
  it('DV10-10: the full Intent → Memory → Policy → ActionPlan pipeline still works', async () => {
    // This test proves that importing sessionSync does not break the
    // existing vertical slice. The pipeline test itself lives in
    // contextOrchestrator.test.ts and verticalSlice.test.ts — this test
    // runs the same canonical sentence and checks the plan is bridgeable.
    const { getDatabase } = await import('../../memory/database');
    const { ensureSeeded } = await import('../../memory');
    const { activateFromText } = await import('../contextOrchestrator');
    const { FallbackParser } = await import('../../ai/parsers');
    const { IntentValidator } = await import('../../ai/validators');


    await getDatabase();
    await ensureSeeded();

    const engine = {
      async parse(text: string) {
        const result = await new FallbackParser().parse(text);
        return IntentValidator.validate(result as any);
      },
    };

    const outcome = await activateFromText("I'm going to study for two hours.", { engine });
    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    // The plan is a valid ActionPlan — it can be sent through the bridge.
    expect(outcome.plan.sessionId).toBeTruthy();
    expect(outcome.plan.actions.length).toBeGreaterThan(0);
    expect(typeof outcome.plan.restoreOnEnd).toBe('boolean');

    // Prove it serialises cleanly (the bridge does JSON.stringify).
    const serialised = JSON.stringify(outcome.plan);
    const deserialised = JSON.parse(serialised) as ActionPlan;
    expect(deserialised).toEqual(outcome.plan);
  });

  // ── TEST 11 — Event vocabulary ─────────────────────────────────────────
  it('DV10-11: the event vocabulary covers the full session lifecycle', () => {
    const events: SessionEvent[] = [...SESSION_EVENTS];
    expect(events).toContain('session_started');
    expect(events).toContain('session_state_changed');
    expect(events).toContain('plan_submitted');
    expect(events).toContain('results_received');
    expect(events).toContain('session_ended');
    expect(events).toHaveLength(5);
  });

  // ── TEST 12 — Singleton export ─────────────────────────────────────────
  it('DV10-12: module exports a default singleton', async () => {
    const { sessionSync } = await import('../sessionSync');
    expect(sessionSync).toBeInstanceOf(SessionSyncClient);
    expect(sessionSync.connectionState).toBe('disconnected');
  });

  // ── Boundary enforcement ───────────────────────────────────────────────
  it('DV10-13: sessionSync.ts does not import AI, memory, policy, or native', async () => {
    // Read the source and verify no forbidden import statements.
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'services', 'sessionSync.ts'),
      'utf-8',
    );

    // Extract only actual import lines (not comments/doc blocks).
    const importLines = source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        // Skip comments and blank lines.
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
          return false;
        }
        return trimmed.startsWith('import ') || trimmed.startsWith('import{');
      });

    const importBlock = importLines.join('\n');

    // Must NOT import these modules.
    expect(importBlock).not.toContain("'../ai");
    expect(importBlock).not.toContain("'../memory");
    expect(importBlock).not.toContain("'../policy");
    expect(importBlock).not.toContain("'../native");
    expect(importBlock).not.toContain('expo-sqlite');

    // DOES import the frozen types — that is correct.
    expect(importBlock).toContain("'../types/policy'");
  });
});
