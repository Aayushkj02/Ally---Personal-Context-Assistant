/**
 * OWNER: AAYUSH — tasks T6, T7, A-V1
 *
 * PUBLIC SURFACE of the action engine. CONSUMES ActionPlan (produced by Dhrey's
 * policy layer) and returns ActionResult[] — see docs/CONTRACTS.md §2.
 *
 * Executes ONLY what is in the plan. No inferred extras, no capability not in the
 * allow-list. This layer is the only thing in the app permitted to change the phone.
 */

import type { ActionResult, ActionStatus, SessionState } from '../types';

export { executePlan, restoreSession, lifoOrder } from './executors';
export type { ActionPhase, ActionProgress, ExecutionDeps, RestoreDeps } from './executors';
export { checkPermissions, permissionNeededResult } from './PermissionGate';
export type { PermissionCheck } from './PermissionGate';
export {
  buildSnapshot,
  createInMemorySnapshotStore,
  snapshotId,
  type SnapshotStore,
} from './SnapshotStore';
export { createRepositorySnapshotStore } from './snapshotStoreAdapter';

/**
 * Plan-level view of a finished run. DERIVED from ActionResult[] — a count, not a second
 * result model, and nothing persists it. `ActionResult` remains the only record of what
 * happened to the phone.
 *
 * `state` reuses the frozen SessionState vocabulary rather than inventing one, because it
 * is exactly what the session layer already expects to be told: src/memory/session.ts
 * says a session starts READY and "the executor moves it to ACTIVE once actions are
 * applied", and endSession() takes PARTIAL. So:
 *
 *   ACTIVE   every action applied — the context is genuinely running
 *   PARTIAL  some applied, some did not. The honest answer for a Study plan today, where
 *            DND and brightness apply and ringer reports not_supported until T5. Rounding
 *            this to "success" or "failure" would be a lie in both directions.
 *   ERROR    nothing applied
 *
 * The executor RETURNS this; it does not write it. Moving the session row is
 * markSessionActive()/endSession() in Dhrey's memory layer, and the action engine does
 * not touch the database.
 */
export interface PlanSummary {
  total: number;
  byStatus: Record<ActionStatus, number>;
  state: Extract<SessionState, 'ACTIVE' | 'PARTIAL' | 'ERROR'>;
}

export function summarisePlan(results: ActionResult[]): PlanSummary {
  const byStatus: Record<ActionStatus, number> = {
    applied: 0,
    permission_needed: 0,
    not_supported: 0,
    skipped: 0,
    failed: 0,
    restored: 0,
  };

  for (const r of results) byStatus[r.status] += 1;

  const applied = byStatus.applied;
  const state: PlanSummary['state'] =
    results.length > 0 && applied === results.length
      ? 'ACTIVE'
      : applied === 0
        ? 'ERROR'
        : 'PARTIAL';

  return { total: results.length, byStatus, state };
}

/**
 * Plan-level view of a finished RESTORE. Same shape as PlanSummary, different success column:
 * a restore succeeds with `restored`, not `applied`, so summarisePlan() would call a perfect
 * restore an ERROR. Hence a second function rather than a flag.
 *
 * `state` again reuses the frozen SessionState vocabulary, and again the values are the ones the
 * session layer already expects, this time from endSession():
 *
 *   IDLE     every snapshot went back. "No context running" — the clean ending.
 *   PARTIAL  anything less. src/memory/session.ts: "Pass PARTIAL when a restore did not fully
 *            succeed, so the snapshots stay meaningful for a retry."
 *
 * There is deliberately no third state. A restore that half-worked is not an ERROR to be
 * discarded — it is unfinished business with rows still on disk, and PARTIAL is what says so.
 * An empty session restores nothing and is IDLE: there was nothing to put back.
 */
export interface RestoreSummary {
  total: number;
  byStatus: Record<ActionStatus, number>;
  state: Extract<SessionState, 'IDLE' | 'PARTIAL'>;
  /**
   * Whether the caller may drop the snapshots. True ONLY on a clean sweep — never after a
   * permission failure or a device error, because those rows are the retry (ADR-117).
   */
  safeToClear: boolean;
}

export function summariseRestore(results: ActionResult[]): RestoreSummary {
  const byStatus: Record<ActionStatus, number> = {
    applied: 0,
    permission_needed: 0,
    not_supported: 0,
    skipped: 0,
    failed: 0,
    restored: 0,
  };

  for (const r of results) byStatus[r.status] += 1;

  // `skipped` is a clean outcome, not a failure: it means the capability had nothing to put back
  // (an alarm the user asked for is not collateral of the context). Everything else is unfinished.
  const clean = byStatus.restored + byStatus.skipped === results.length;

  return {
    total: results.length,
    byStatus,
    state: clean ? 'IDLE' : 'PARTIAL',
    safeToClear: clean,
  };
}
