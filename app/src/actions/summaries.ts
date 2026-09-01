/**
 * OWNER: AAYUSH — tasks A-V1, A-V2
 *
 * Plan- and restore-level summaries, DERIVED from ActionResult[]. Counts, not a second result
 * model — `ActionResult` remains the only record of what happened to the phone, and nothing here
 * is persisted.
 *
 * These live in their own module rather than in index.ts so that ContextCoordinator can use them
 * without importing the barrel that exports the coordinator itself. A cycle there would work
 * today and break the first time someone moved a call to module-initialisation time.
 */

import type { ActionResult, ActionStatus, SessionState } from '../types';

function tally(results: ActionResult[]): Record<ActionStatus, number> {
  const byStatus: Record<ActionStatus, number> = {
    applied: 0,
    permission_needed: 0,
    not_supported: 0,
    skipped: 0,
    failed: 0,
    restored: 0,
  };

  for (const r of results) byStatus[r.status] += 1;
  return byStatus;
}

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
  const byStatus = tally(results);

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

/**
 * The summary for a restore that could not even be attempted, because the snapshots were
 * unreadable.
 *
 * NOT `summariseRestore([])`. An empty result set means "there was nothing to put back", which is
 * IDLE and safe to clear. This means "we could not find out what to put back", which is the
 * opposite: the phone is still changed, the rows must be kept, and the only honest state is
 * PARTIAL. Collapsing the two would report a context as cleanly ended while Ally was still
 * holding the user's settings — the same distinction EmergencyMonitor draws between `ok: false`
 * and `detected: false` (ADR-122).
 */
export function unreadableRestore(): RestoreSummary {
  return {
    total: 0,
    byStatus: tally([]),
    state: 'PARTIAL',
    safeToClear: false,
  };
}

export function summariseRestore(results: ActionResult[]): RestoreSummary {
  const byStatus = tally(results);

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
