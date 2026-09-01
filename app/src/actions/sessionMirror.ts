/**
 * OWNER: AAYUSH — task A6.5
 *
 * Pushes what happened to the phone out to the laptop, so a second screen can mirror the live
 * session.
 *
 * SOFTWARE ONLY. THE PHYSICAL OFFICE KIT DOES NOT EXIST YET.
 *
 * > Physical Office Kit validation is deferred until the team qualifies for the Pune round and
 * > receives the Office Kit. Until then, development and real-device testing use the Samsung
 * > Galaxy S24 Ultra.
 *
 * Everything in this file is session-sync plumbing: it serialises objects the lifecycle already
 * produced and hands them to a transport. Nothing here has ever spoken to Office Kit hardware, and
 * a green test in `sessionMirror.test.ts` proves session-sync logic — NOT that any physical device
 * mirrored anything. The two claims are not interchangeable and this file will not blur them.
 *
 * WHY IT EXISTS. `src/services/sessionSync.ts` (Dhrey, D-V10) is a complete client for
 * `POST /session` — wire format, validation, connection state, fire-and-forget failure handling —
 * and until now it had ZERO callers anywhere in the app. The transport was built; nothing drove
 * it. The events it wants (a context started, a plan was submitted, results came back, the session
 * ended) all happen inside `startContext()` / `endContext()`, which is Aayush's layer. So this is
 * the missing half: his interface, used unmodified, driven from where the lifecycle actually is.
 *
 * NOT A SECOND SOURCE OF TRUTH. Every value forwarded here comes straight out of a
 * `StartContextResult` or `EndContextResult`. This module computes no status, derives no state and
 * stores nothing. If the laptop and the phone ever disagree, it is because the phone changed after
 * the last push — never because this file decided something on its own.
 *
 * A MIRROR MUST NEVER AFFECT THE THING IT MIRRORS. Every call is awaited inside a try/catch that
 * swallows, on top of a transport that already swallows. A dead laptop, a wrong URL or a bridge
 * mid-restart must be invisible to someone using their phone — the same rule the lifecycle hooks
 * follow (ADR-118), for the same reason: bookkeeping that failed does not un-change a device.
 */

import type { ActionPlan, ActionResult, SessionState } from '../types';
import type { EndContextResult, StartContextResult } from './ContextCoordinator';

/**
 * The transport seam. Structurally identical to the methods `sessionSync` already exposes, so the
 * real client satisfies it without an adapter — and a test can pass a recorder instead.
 *
 * Deliberately NOT an import of Dhrey's class: depending on the shape rather than the instance is
 * what keeps this file testable in Node with no bridge running, and what lets the Office Kit
 * eventually arrive behind the same four methods without this module changing at all.
 */
export interface SessionMirrorTransport {
  syncSessionStarted(
    sessionId: string,
    activeProfileId: string,
    sessionState: SessionState,
    durationMinutes: number | null,
  ): Promise<void>;
  syncPlanSubmitted(sessionId: string, activeProfileId: string, plan: ActionPlan): Promise<void>;
  syncResultsReceived(sessionId: string, results: ActionResult[]): Promise<void>;
  syncStateChanged(
    sessionId: string,
    activeProfileId: string | null,
    sessionState: SessionState,
  ): Promise<void>;
  syncSessionEnded(sessionId: string, finalState: SessionState): Promise<void>;
}

export interface MirrorContext {
  /** The profile the session belongs to, from Dhrey's session row. */
  profileId: string;
  /** Session length in minutes, or null for open-ended. Straight from the intent. */
  durationMinutes?: number | null;
}

/** Never throws, never rejects. A mirror that can break the thing it mirrors is worse than none. */
async function quietly(send: () => Promise<void>): Promise<boolean> {
  try {
    await send();
    return true;
  } catch {
    // Swallowed on purpose, on top of a transport that also swallows. The phone is standalone.
    return false;
  }
}

/**
 * What a mirror push actually managed to do.
 *
 * Reported rather than assumed, because "we sent it" and "the laptop has it" are different claims
 * and only the first is checkable from here — the same distinction the alarm capability draws
 * about the Clock app (ADR-127). `delivered: false` means the transport refused or the bridge was
 * unreachable; it never means the session is in doubt.
 */
export interface MirrorOutcome {
  /** Events this push attempted, in order. */
  events: string[];
  /** True only if every attempted event was accepted by the transport. */
  delivered: boolean;
}

/**
 * Mirrors a context that has just started.
 *
 * Order matters and follows the lifecycle rather than convenience: the session exists first, then
 * the plan that was submitted for it, then the results that came back. A laptop replaying these in
 * order sees the same story the phone did.
 *
 * The plan is pushed even when nothing applied. A context that failed entirely is still something
 * the user did, and a mirror that showed only successes would be a highlight reel.
 */
export async function mirrorContextStart(
  plan: ActionPlan,
  result: StartContextResult,
  transport: SessionMirrorTransport,
  context: MirrorContext,
): Promise<MirrorOutcome> {
  const events: string[] = [];
  let delivered = true;

  const push = async (event: string, send: () => Promise<void>): Promise<void> => {
    events.push(event);
    if (!(await quietly(send))) delivered = false;
  };

  await push('session_started', () =>
    transport.syncSessionStarted(
      result.sessionId,
      context.profileId,
      result.state,
      context.durationMinutes ?? null,
    ),
  );

  await push('plan_submitted', () =>
    transport.syncPlanSubmitted(result.sessionId, context.profileId, plan),
  );

  await push('results_received', () =>
    transport.syncResultsReceived(result.sessionId, result.results),
  );

  // The state the coordinator settled on — ACTIVE, PARTIAL or ERROR — forwarded verbatim. This is
  // the one value a laptop most needs and the one it must never recompute: PARTIAL is a real
  // outcome, and a mirror that rounded it to "running" would undo the whole status vocabulary.
  await push('session_state_changed', () =>
    transport.syncStateChanged(result.sessionId, context.profileId, result.state),
  );

  return { events, delivered };
}

/**
 * Mirrors a context that has just ended.
 *
 * The restore results go across before the ending, so a laptop can show WHAT was put back and not
 * merely that something was. `IDLE` and `PARTIAL` are both forwarded as-is: a restore that fell
 * short is unfinished business the second screen should be able to display, not an ending to round
 * up (ADR-117).
 */
export async function mirrorContextEnd(
  result: EndContextResult,
  transport: SessionMirrorTransport,
  context: MirrorContext,
): Promise<MirrorOutcome> {
  const events: string[] = [];
  let delivered = true;

  const push = async (event: string, send: () => Promise<void>): Promise<void> => {
    events.push(event);
    if (!(await quietly(send))) delivered = false;
  };

  await push('results_received', () =>
    transport.syncResultsReceived(result.sessionId, result.results),
  );

  await push('session_ended', () => transport.syncSessionEnded(result.sessionId, result.state));

  return { events, delivered };
}

/**
 * A recorder that satisfies the transport and keeps what it was given.
 *
 * THIS IS A MOCK, AND IT IS A MOCK OF A TRANSPORT — not of Office Kit hardware. It exists so
 * session-sync logic can be tested with no bridge running. It proves message shape, ordering and
 * containment. It proves nothing whatsoever about a physical device, and no result derived from it
 * may be reported as hardware validation.
 */
export function createRecordingTransport(options: { failEvery?: number } = {}): {
  transport: SessionMirrorTransport;
  sent: { event: string; sessionId: string; payload: unknown }[];
} {
  const sent: { event: string; sessionId: string; payload: unknown }[] = [];
  let calls = 0;

  const record = async (event: string, sessionId: string, payload: unknown): Promise<void> => {
    calls += 1;
    if (options.failEvery && calls % options.failEvery === 0) {
      throw new Error('bridge unreachable');
    }
    sent.push({ event, sessionId, payload });
  };

  return {
    sent,
    transport: {
      syncSessionStarted: (sessionId, activeProfileId, sessionState, durationMinutes) =>
        record('session_started', sessionId, { activeProfileId, sessionState, durationMinutes }),
      syncPlanSubmitted: (sessionId, activeProfileId, plan) =>
        record('plan_submitted', sessionId, { activeProfileId, plan }),
      syncResultsReceived: (sessionId, results) =>
        record('results_received', sessionId, { results }),
      syncStateChanged: (sessionId, activeProfileId, sessionState) =>
        record('session_state_changed', sessionId, { activeProfileId, sessionState }),
      syncSessionEnded: (sessionId, finalState) =>
        record('session_ended', sessionId, { finalState }),
    },
  };
}
