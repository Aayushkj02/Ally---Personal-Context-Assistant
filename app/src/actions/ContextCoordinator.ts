/**
 * OWNER: AAYUSH — task A-V3
 *
 * The context lifecycle, on the device side:
 *
 *   READY  ──startContext(plan)──►  ACTIVE | PARTIAL | ERROR
 *                                        │
 *                                        └──endContext(sessionId)──►  IDLE | PARTIAL
 *
 * This file COMPOSES `executePlan()` and `restoreSession()`. It re-implements neither, and it
 * owns no policy, no session table and no persistence of its own. Everything it knows about a
 * context arrives as an argument or comes back out of the `SnapshotStore`.
 *
 * WHY IT EXISTS (ADR-118): the same two sequences — execute → summarise → mark active, and
 * restore → summarise → decide about the rows — were written by hand in the Phase 1 harness and
 * would have been written again by every future caller. Each one has a rule that is easy to get
 * quietly wrong: never report ACTIVE when nothing applied, and never drop the snapshots after a
 * restore that only half-worked. Those two rules now live in one place with tests on them.
 *
 * THE SESSION BOUNDARY IS A HOOK, NOT A CALL. Moving a session row is Dhrey's
 * `markSessionActive()` / `endSession()`, and those are database writes this layer must not make
 * (ADR-114/115). The coordinator reports what happened through optional callbacks and lets the
 * caller connect them. A caller that wires nothing still gets correct device behaviour.
 */

import type {
  ActionPlan,
  ActionResult,
  ChannelEnforcement,
  DeviceRegistry,
  SessionState,
} from '../types';
import { executePlan, restoreSession, type ActionProgress, type BorrowedPolicy } from './executors';
import { explainResults, type ExplainedResult } from './provenance';
import type { SnapshotStore } from './SnapshotStore';
import {
  summarisePlan,
  summariseRestore,
  type PlanSummary,
  type RestoreSummary,
} from './summaries';

/**
 * Where a context got to. Every value is an existing `SessionState` — no new vocabulary.
 *
 *   READY    nothing has been attempted yet
 *   ACTIVE   every planned action applied; the context is genuinely running
 *   PARTIAL  some applied, some did not — or a restore that did not finish
 *   ERROR    nothing applied
 *   IDLE     everything was put back; no context is running
 */
export type ContextState = Extract<SessionState, 'READY' | 'ACTIVE' | 'PARTIAL' | 'ERROR' | 'IDLE'>;

/**
 * Hooks onto the session lifecycle. All optional, all fire-and-forget from here.
 *
 * These exist so the caller can connect Dhrey's session functions WITHOUT this layer importing
 * them: `onActivated` → `markSessionActive(sessionId)`, `onEnded`/`onPartial` →
 * `endSession(sessionId, { status })`. A throw inside a hook is contained — a session row that
 * failed to update must never make a device change that already happened look like it did not.
 */
export interface LifecycleHooks {
  /** A context is about to be applied. Fires before any device change. */
  onStarted?: (sessionId: string) => void | Promise<void>;
  /** Something actually changed on the phone. The caller's cue to move READY → ACTIVE. */
  onActivated?: (sessionId: string, state: ContextState) => void | Promise<void>;
  /** Nothing applied at all. The device is untouched. */
  onFailed?: (sessionId: string, results: ActionResult[]) => void | Promise<void>;
  /**
   * A RESTORE fell short — some values did not go back. Snapshots are retained whenever this
   * fires, so the caller can offer a retry.
   *
   * SCOPED TO endContext() ON PURPOSE. It originally fired from startContext() too, for a plan
   * that only partly applied, and that cost an afternoon: the harness wired it to endSession(),
   * so a PARTIAL apply immediately ended the session it had just started, and endContext() then
   * reported "no active context to end". A hook whose meaning depends on which call fired it is
   * a hook that will be miswired. A partial APPLY is already fully described by
   * onActivated(sessionId, 'PARTIAL') — the state is right there in the argument.
   */
  onPartial?: (sessionId: string, results: ActionResult[]) => void | Promise<void>;
  /** Everything went back. The caller's cue to end the session as IDLE. */
  onEnded?: (sessionId: string, state: ContextState) => void | Promise<void>;
}

export interface CoordinatorDeps {
  /** Handed in, never reached for — the same rule as executePlan() (ADR-115). */
  registry: DeviceRegistry;
  snapshots: SnapshotStore;
  hooks?: LifecycleHooks;
  onProgress?: (event: ActionProgress) => void;
  now?: () => number;
  /**
   * Applies this context's priority preferences — who may still reach the user while it runs.
   *
   * INJECTED, and deliberately opaque to the coordinator (ADR-119). Resolving which contacts
   * and channels a context allows is Dhrey's `applyPriorityForContext()`; sending it to Android
   * is `applyPriorityPreferences()` in src/native; Dhrey's own module already wires those two
   * together. All the coordinator decides is WHEN it happens — after the plan, and never when
   * the plan applied nothing. Passing a thunk rather than a request object is what keeps a
   * second priority policy from growing here.
   */
  applyPriority?: () => Promise<ChannelEnforcement[] | null>;
  /**
   * The user's own notification policy, when the backend keeps one.
   *
   * Wired for the same reason `applyPriority` is: priority rewrites that policy from outside the
   * plan, so ending a context has to be able to give it back even when no `dnd` action was ever
   * planned (ADR-125). Passing the applier without this one is the asymmetry that made the
   * change irreversible in the first place.
   */
  policy?: BorrowedPolicy;
}

export interface StartContextResult {
  sessionId: string;
  state: ContextState;
  results: ActionResult[];
  summary: PlanSummary;
  /**
   * Per-channel outcome in the four-state vocabulary — `enforced`, `preference_only`,
   * `unsupported`, `failed`. Never collapsed into the plan's own status, because "your
   * WhatsApp preference is remembered but Android will not act on it" is a different fact
   * from "the context is active" and the user needs both (ADR-113).
   *
   * null means no applier was wired, not that priority succeeded or failed.
   */
  priority: ChannelEnforcement[] | null;
  /**
   * Each outcome paired with the reason its planned action carried — "from your active profile"
   * for a value the user taught Ally, "from system defaults" for one they never chose (A4.2).
   *
   * Derived, not stored, and the sentences are Dhrey's verbatim. It rides on the result because
   * this is the only place that holds BOTH the plan and the outcomes; a caller that wanted it
   * later would have to keep the plan alive itself, and the first one that forgot would silently
   * show a phone full of changes with nothing to explain them.
   */
  explained: ExplainedResult[];
}

export interface EndContextResult {
  sessionId: string;
  state: ContextState;
  results: ActionResult[];
  summary: RestoreSummary;
  /** True only when the restore was clean AND the rows were actually dropped. */
  cleared: boolean;
  /** Retained rows mean the caller may call endContext() again to finish the job. */
  retryable: boolean;
}

/** A hook must never be able to turn a real device outcome into a thrown error. */
async function fire(
  hook: ((...args: never[]) => void | Promise<void>) | undefined,
  run: () => void | Promise<void>,
): Promise<void> {
  if (!hook) return;
  try {
    await run();
  } catch {
    // Deliberately swallowed. The device already moved; a bookkeeping failure upstream does not
    // un-move it, and reporting it as an execution failure would be a lie about the phone.
  }
}

/**
 * Apply a context.
 *
 * Takes an ActionPlan that someone else produced — this layer never builds one. `plan.sessionId`
 * is the only identity it needs, and it is carried straight through to the snapshots so
 * endContext() can find them later with nothing else in hand.
 *
 * ACTIVE is claimed only when every action applied. A plan where DND and brightness applied but
 * the ringer came back `not_supported` is PARTIAL, and stays PARTIAL — rounding that up to
 * success is exactly the lie the status vocabulary exists to prevent (PRD §20, NFR-03).
 */
export async function startContext(
  plan: ActionPlan,
  deps: CoordinatorDeps,
): Promise<StartContextResult> {
  const { registry, snapshots, hooks, onProgress, now } = deps;
  const sessionId = plan.sessionId;

  await fire(hooks?.onStarted, () => hooks?.onStarted?.(sessionId));

  const results = await executePlan(plan, { registry, snapshots, onProgress, now });
  const summary = summarisePlan(results);
  const state: ContextState = summary.state;

  // Priority runs AFTER the plan and only when the plan actually changed something. Letting
  // people through a context that never started would rewrite the user's notification policy
  // for nothing — and on a total failure the device is untouched, which is the promise.
  let priority: ChannelEnforcement[] | null = null;
  if (state !== 'ERROR' && deps.applyPriority) {
    try {
      priority = await deps.applyPriority();
    } catch {
      // Contained for the same reason a hook is: the plan already moved the phone, and a
      // priority call that blew up must not turn that into a thrown startContext. Dhrey's
      // applier converts device failures into `failed` rows rather than throwing, so reaching
      // here means the seam itself broke, and null says "no answer" rather than inventing one.
      priority = null;
    }
  }

  if (state === 'ERROR') {
    await fire(hooks?.onFailed, () => hooks?.onFailed?.(sessionId, results));
  } else {
    // Something moved on the phone, so the session is no longer merely READY. PARTIAL still
    // counts as activated: two of three settings changed, and the user can see them. `state`
    // carries the shortfall, so onPartial is NOT fired here — see its doc comment.
    await fire(hooks?.onActivated, () => hooks?.onActivated?.(sessionId, state));
  }

  return { sessionId, state, results, summary, priority, explained: explainResults(plan, results) };
}

export interface EndContextOptions {
  /**
   * Keep the snapshots even after a clean restore. Off by default; a caller that wants to inspect
   * the rows, or clear them itself, sets this. A partial restore retains them regardless.
   */
  keepSnapshots?: boolean;
}

/**
 * End a context and put the device back.
 *
 * ONLY a sessionId is required, and that is the point: after the app has been force-stopped and
 * reopened there is no in-memory record of what was changed, and there does not need to be. The
 * snapshots are the record (ADR-117), so this works identically on a fresh process.
 *
 * Snapshots are dropped ONLY on a completely clean restore. If anything came back
 * `permission_needed`, `failed` or `not_supported`, the rows stay exactly as they are and the
 * result is marked `retryable` — those rows ARE the retry, and deleting them would strand the
 * user with a half-changed phone and no way back.
 */
export async function endContext(
  sessionId: string,
  deps: CoordinatorDeps,
  options: EndContextOptions = {},
): Promise<EndContextResult> {
  const { registry, snapshots, hooks, onProgress } = deps;

  const results = await restoreSession(sessionId, {
    registry,
    snapshots,
    onProgress,
    policy: deps.policy,
  });
  const summary = summariseRestore(results);
  const state: ContextState = summary.state;

  // Clearing goes through the SnapshotStore's own contract, never through SQL. `safeToClear` is
  // the single gate, and it is false for anything short of a clean sweep.
  const cleared = summary.safeToClear && options.keepSnapshots !== true;
  if (cleared) await snapshots.clear(sessionId);

  if (state === 'IDLE') {
    await fire(hooks?.onEnded, () => hooks?.onEnded?.(sessionId, state));
  } else {
    await fire(hooks?.onPartial, () => hooks?.onPartial?.(sessionId, results));
  }

  return {
    sessionId,
    state,
    results,
    summary,
    cleared,
    retryable: !summary.safeToClear,
  };
}

/**
 * Retry an incomplete restore.
 *
 * Deliberately the same call as endContext(): the snapshots were never consumed, so replaying the
 * walk re-attempts exactly the rows that did not go back, and re-restoring one that already did
 * is harmless — it writes the same value again. There is no separate retry path to keep in sync,
 * and no new snapshot is ever captured on a restore, so the original pre-Ally values survive
 * however many attempts it takes.
 */
export async function restoreContext(
  sessionId: string,
  deps: CoordinatorDeps,
  options: EndContextOptions = {},
): Promise<EndContextResult> {
  return endContext(sessionId, deps, options);
}
