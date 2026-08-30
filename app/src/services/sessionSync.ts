/**
 * OWNER: DHREY — task D-V10 (Session Sync / Bridge)
 *
 * Fire-and-forget POST /session so the laptop dashboard can mirror the live session.
 * Failures are swallowed. The phone is fully functional standalone.
 *
 * CONTRACTS.md §4 defines the wire format:
 *
 *   POST /session  { event, sessionId, payload }  → 204  fire-and-forget
 *
 * This module is a TRANSPORT BOUNDARY. It serialises existing domain objects
 * (ActionPlan, ActionResult, SessionState) and sends them over HTTP. It does
 * NOT import or execute:
 *
 *   - expo-sqlite / any database
 *   - PolicyEngine / resolve / resolvePriority
 *   - IntentEngine / FallbackParser / OllamaParser
 *   - Native capabilities / Android APIs
 *
 * Those responsibilities belong to their owning layers. The bridge transports
 * the already-resolved data — nothing more.
 */

import type { ActionPlan, ActionResult, SessionState } from '../types/policy';

// ---------------------------------------------------------------------------
// Session event vocabulary
// ---------------------------------------------------------------------------

/**
 * Events the phone pushes to the laptop bridge.
 *
 * Each maps 1-to-1 to a lifecycle transition in the Zustand store (D-V8)
 * or the session module (D-V7). The bridge does not invent new transitions.
 */
export const SESSION_EVENTS = [
  'session_started',
  'session_state_changed',
  'plan_submitted',
  'results_received',
  'session_ended',
] as const;
export type SessionEvent = (typeof SESSION_EVENTS)[number];

// ---------------------------------------------------------------------------
// Message shape — CONTRACTS.md §4
// ---------------------------------------------------------------------------

/** Payload varies by event. Always JSON-serialisable, never a database row. */
export type SessionPayload =
  | SessionStartedPayload
  | SessionStateChangedPayload
  | PlanSubmittedPayload
  | ResultsReceivedPayload
  | SessionEndedPayload;

export interface SessionStartedPayload {
  activeProfileId: string;
  sessionState: SessionState;
  durationMinutes: number | null;
}

export interface SessionStateChangedPayload {
  activeProfileId: string | null;
  sessionState: SessionState;
}

export interface PlanSubmittedPayload {
  activeProfileId: string;
  plan: ActionPlan;
}

export interface ResultsReceivedPayload {
  results: ActionResult[];
}

export interface SessionEndedPayload {
  finalState: SessionState;
}

/**
 * The wire message. Exactly what CONTRACTS.md §4 specifies:
 *
 *   { event, sessionId, payload }
 */
export interface SessionSyncMessage {
  event: SessionEvent;
  sessionId: string;
  payload: SessionPayload;
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

export const CONNECTION_STATES = ['disconnected', 'connecting', 'connected', 'error'] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Returns true only when the message has the three required fields and a known event. */
export function isValidSyncMessage(data: unknown): data is SessionSyncMessage {
  if (data === null || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  if (typeof obj.event !== 'string') return false;
  if (!(SESSION_EVENTS as readonly string[]).includes(obj.event)) return false;
  if (typeof obj.sessionId !== 'string' || obj.sessionId.length === 0) return false;
  if (obj.payload === null || obj.payload === undefined || typeof obj.payload !== 'object')
    return false;

  return true;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface SessionSyncConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Fire-and-forget HTTP client for POST /session.
 *
 * Every public method swallows failures silently — a dead bridge is invisible
 * to the user (CONTRACTS.md §4, ADR-003).
 */
export class SessionSyncClient {
  private baseUrl: string;
  private timeoutMs: number;
  private _connectionState: ConnectionState = 'disconnected';

  constructor(config: SessionSyncConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://127.0.0.1:3000';
    this.timeoutMs = config.timeoutMs ?? 2500;
  }

  /** Current connection state. Runtime only — never persisted. */
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /**
   * Probes the bridge via GET /health. Updates connection state.
   *
   * This piggybacks on the same /health Shlok's bridge exposes for the
   * "local AI connected" chip — no second endpoint needed.
   */
  async checkConnection(): Promise<boolean> {
    this._connectionState = 'connecting';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        this._connectionState = 'connected';
        return true;
      }

      this._connectionState = 'error';
      return false;
    } catch {
      this._connectionState = 'disconnected';
      return false;
    }
  }

  /** Mark the client as disconnected. Idempotent. */
  disconnect(): void {
    this._connectionState = 'disconnected';
  }

  // -----------------------------------------------------------------------
  // Session event dispatch
  // -----------------------------------------------------------------------

  /** A new session was created. */
  async syncSessionStarted(
    sessionId: string,
    activeProfileId: string,
    sessionState: SessionState,
    durationMinutes: number | null,
  ): Promise<void> {
    await this.send({
      event: 'session_started',
      sessionId,
      payload: { activeProfileId, sessionState, durationMinutes },
    });
  }

  /** The session state transitioned (READY → APPLYING → ACTIVE, etc.). */
  async syncStateChanged(
    sessionId: string,
    activeProfileId: string | null,
    sessionState: SessionState,
  ): Promise<void> {
    await this.send({
      event: 'session_state_changed',
      sessionId,
      payload: { activeProfileId, sessionState },
    });
  }

  /** An ActionPlan was produced and is about to be applied. */
  async syncPlanSubmitted(
    sessionId: string,
    activeProfileId: string,
    plan: ActionPlan,
  ): Promise<void> {
    await this.send({
      event: 'plan_submitted',
      sessionId,
      payload: { activeProfileId, plan },
    });
  }

  /** ActionResults came back from the execution layer. */
  async syncResultsReceived(sessionId: string, results: ActionResult[]): Promise<void> {
    await this.send({
      event: 'results_received',
      sessionId,
      payload: { results },
    });
  }

  /** The session ended. */
  async syncSessionEnded(sessionId: string, finalState: SessionState): Promise<void> {
    await this.send({
      event: 'session_ended',
      sessionId,
      payload: { finalState },
    });
  }

  // -----------------------------------------------------------------------
  // Resynchronisation
  // -----------------------------------------------------------------------

  /**
   * After a reconnect, push the current runtime context to the laptop so it
   * does not show stale data.
   *
   * This is NOT a database replication — it sends only the identifiers and
   * the current plan/results the store already holds.
   */
  async resync(context: {
    sessionId: string;
    activeProfileId: string | null;
    sessionState: SessionState;
    plan: ActionPlan | null;
    results: ActionResult[];
  }): Promise<void> {
    // State first — so the dashboard knows what phase we are in.
    await this.syncStateChanged(context.sessionId, context.activeProfileId, context.sessionState);

    // Plan, if one exists.
    if (context.plan && context.activeProfileId) {
      await this.syncPlanSubmitted(context.sessionId, context.activeProfileId, context.plan);
    }

    // Results, if any have come back.
    if (context.results.length > 0) {
      await this.syncResultsReceived(context.sessionId, context.results);
    }
  }

  // -----------------------------------------------------------------------
  // Transport — the single exit point
  // -----------------------------------------------------------------------

  /**
   * POST /session with the given message. Fire-and-forget.
   *
   * NEVER throws. NEVER blocks the UI. A dead bridge is invisible.
   */
  private async send(message: SessionSyncMessage): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        this._connectionState = 'connected';
        return true;
      }

      this._connectionState = 'error';
      return false;
    } catch {
      // Fire-and-forget. A dead bridge is invisible (CONTRACTS.md §4).
      this._connectionState = 'disconnected';
      return false;
    }
  }
}

/** Default singleton, same pattern as bridgeClient.ts. */
export const sessionSync = new SessionSyncClient();
