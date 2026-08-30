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

export { executePlan } from './executors';
export type { ActionPhase, ActionProgress, ExecutionDeps } from './executors';
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
