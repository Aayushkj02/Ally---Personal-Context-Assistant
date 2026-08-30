/**
 * OWNER: AAYUSH — tasks T7, A-V1 (Phase 2 vertical slice)
 *
 * executePlan(): walks an ActionPlan in order. Per action (FLOW.md §5):
 *
 *   in allow-list? -> available? -> permission? -> snapshot -> execute -> READ BACK
 *
 * THE READ-BACK IS NOT OPTIONAL. `applied` may only be returned for a write we
 * confirmed by reading the value again; everything else is failed /
 * permission_needed / not_supported. This is the "never fake success" rule
 * (PRD §20, NFR-03) — the single most load-bearing rule in the codebase. The
 * verification itself lives inside each DeviceCapability, which is the only layer that
 * can see the device; the executor's job is to make sure nothing skips it, and never to
 * upgrade a capability's verdict.
 *
 * This file is the bridge between Dhrey's policy output and the device capability layer,
 * and it is the ONLY way into that layer. It must never interpret language, call the LLM,
 * decide policy, read the database, or reach an Android API directly (docs/CONTRACTS.md §2).
 *
 * One action failing NEVER aborts the plan. Each row reports independently, and the
 * returned array is exactly one ActionResult per PlannedAction, in the same order.
 */

import type {
  ActionPlan,
  ActionResult,
  ActionStatus,
  Capability,
  DeviceCapability,
  DeviceRegistry,
  DeviceSnapshot,
  PlannedAction,
} from '../../types';
import { isCapability } from '../../types';
import { checkPermissions, permissionNeededResult } from '../PermissionGate';
import { buildSnapshot, createInMemorySnapshotStore, type SnapshotStore } from '../SnapshotStore';

/**
 * Progress phases, which are deliberately NOT ActionStatus values (ADR-115).
 *
 * `pending` and `running` describe where the walk is; `applied`/`failed`/… describe what
 * happened to the phone. Collapsing them into the frozen `ACTION_STATUSES` would let a row
 * be persisted as "running" forever if the app died mid-plan, and would put a non-outcome
 * into a vocabulary the user reads. So progress is a transient callback, and only outcomes
 * are ever returned or stored.
 */
export type ActionPhase = 'pending' | 'running' | 'settled';

export interface ActionProgress {
  /** Index into plan.actions. */
  index: number;
  capability: Capability;
  phase: ActionPhase;
  /** Populated on `settled` only. */
  result: ActionResult | null;
  /** Policy declared a permission the capability does not report. Diagnostic only. */
  declaredPermissionMismatch: boolean;
}

export interface ExecutionDeps {
  /**
   * REQUIRED, and required on purpose. The executor never reaches for the device itself —
   * it is handed one. That is what keeps `mockRegistry` and the real Kotlin-backed registry
   * interchangeable (ADR-007) and what lets this file be tested in Node with no phone.
   */
  registry: DeviceRegistry;
  /**
   * Where pre-change values are recorded. Defaults to a process-lifetime store; the real
   * app passes `createRepositorySnapshotStore()` so they survive in Dhrey's table.
   */
  snapshots?: SnapshotStore;
  onProgress?: (event: ActionProgress) => void;
  /** Injectable clock so snapshot timestamps are deterministic under test. */
  now?: () => number;
}

function resultFor(
  capability: Capability,
  status: ActionStatus,
  message: string,
  current: ActionResult['beforeValue'] = null,
): ActionResult {
  return { capability, status, beforeValue: current, afterValue: current, message };
}

/**
 * Runs one action to completion. Never throws — a capability that blows up becomes a
 * `failed` row so the rest of the plan still runs.
 */
async function executeAction(
  action: PlannedAction,
  sessionId: string,
  registry: DeviceRegistry,
  snapshots: SnapshotStore,
  now: () => number,
): Promise<{ result: ActionResult; declaredPermissionMismatch: boolean }> {
  // 1. Allow-list check. The plan is built from a ResolvedPolicy that is ultimately fed by
  //    model output, so the capability name is validated at runtime and not merely trusted
  //    from its type (SRS FR-13, FR-27).
  if (!isCapability(action.capability)) {
    return {
      result: resultFor(
        action.capability,
        'not_supported',
        `Ally does not know how to change "${String(action.capability)}".`,
      ),
      declaredPermissionMismatch: false,
    };
  }

  let capability: DeviceCapability;
  try {
    capability = registry.get(action.capability);
  } catch {
    return {
      result: resultFor(action.capability, 'not_supported', 'This is not available on your phone.'),
      declaredPermissionMismatch: false,
    };
  }

  try {
    // 2. Availability. An honest `false` here is a better outcome than a fake success
    //    (ADR-104) — this is what an unimplemented capability reports, and it is why a
    //    Study plan reports `ringer: not_supported` until T5 lands.
    if (!(await capability.isAvailable())) {
      return {
        result: resultFor(
          action.capability,
          'not_supported',
          'This is not available on your phone.',
        ),
        declaredPermissionMismatch: false,
      };
    }

    // 3. Permission, checked BEFORE the mutation and never after. A denial returns without
    //    attempting anything, so the device is never left half-changed (SRS FR-12).
    const check = await checkPermissions(capability, action);
    if (!check.granted) {
      const current = await capability.snapshot();
      return {
        result: permissionNeededResult(action, check, current),
        declaredPermissionMismatch: check.declaredMismatch,
      };
    }

    // 4. Snapshot, so the value can be put back later. A null reading means there is
    //    nothing restorable (the alarm) — that is not an error and must not block the write.
    if (action.needsSnapshot) {
      const previous = await capability.snapshot();
      if (previous !== null) {
        await snapshots.save(buildSnapshot(sessionId, action.capability, previous, now()));
      }
    }

    // 5. Execute. The capability applies the value and reads it back itself; whatever it
    //    reports is what we report.
    const result = await capability.execute(action.value);
    return { result, declaredPermissionMismatch: check.declaredMismatch };
  } catch (e) {
    return {
      result: resultFor(
        action.capability,
        'failed',
        e instanceof Error ? e.message : 'This change did not go through.',
      ),
      declaredPermissionMismatch: false,
    };
  }
}

/**
 * ORDERING: strictly the array order of `plan.actions`, one at a time.
 *
 * docs/CONTRACTS.md §2 makes ordering Dhrey's guarantee — "actions are ordered as they
 * should execute" — so the executor honours the order it is given and never reorders or
 * parallelises. For the Study plan specifically the three actions are independent (DND,
 * brightness and ringer touch unrelated settings), so their order does not matter; it is
 * still executed deterministically rather than concurrently, because a plan whose actions
 * DO interact must behave predictably and there is no flag distinguishing the two cases.
 */
export async function executePlan(plan: ActionPlan, deps: ExecutionDeps): Promise<ActionResult[]> {
  const { registry, onProgress } = deps;
  const snapshots = deps.snapshots ?? createInMemorySnapshotStore();
  const now = deps.now ?? Date.now;

  const results: ActionResult[] = [];

  for (const [index, action] of plan.actions.entries()) {
    onProgress?.({
      index,
      capability: action.capability,
      phase: 'pending',
      result: null,
      declaredPermissionMismatch: false,
    });
    onProgress?.({
      index,
      capability: action.capability,
      phase: 'running',
      result: null,
      declaredPermissionMismatch: false,
    });

    const { result, declaredPermissionMismatch } = await executeAction(
      action,
      plan.sessionId,
      registry,
      snapshots,
      now,
    );

    results.push(result);
    onProgress?.({
      index,
      capability: action.capability,
      phase: 'settled',
      result,
      declaredPermissionMismatch,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// A-V2 — restore
// ---------------------------------------------------------------------------

export interface RestoreDeps {
  /** Same rule as execution: the executor is handed a device, it never reaches for one. */
  registry: DeviceRegistry;
  /** Where the pre-change values were recorded. Required — there is nothing to restore without it. */
  snapshots: SnapshotStore;
  onProgress?: (event: ActionProgress) => void;
}

/**
 * LIFO: undo in the reverse of the order things were applied.
 *
 * Snapshots arrive in capture order (`ORDER BY capturedAt ASC`), and capture order is application
 * order because the executor snapshots immediately before each write. Reversing that array is
 * therefore the reverse of application, which is what §6 asks for.
 *
 * TIES: `capturedAt` is a millisecond clock, so two captures in the same millisecond — reachable
 * whenever a test injects a frozen clock, and not impossible on a fast device — compare equal, and
 * SQL leaves their relative order unspecified. So the reversal is done FIRST and the sort is a
 * stable sort applied to the already-reversed array: equal timestamps keep reverse-storage order
 * rather than falling back to whatever the database happened to return. Order is never left to
 * chance, even when the clock cannot distinguish two rows.
 */
export function lifoOrder(snapshots: DeviceSnapshot[]): DeviceSnapshot[] {
  return [...snapshots].reverse().sort((a, b) => b.capturedAt - a.capturedAt);
}

/**
 * Puts the device back the way the user had it.
 *
 * Driven ENTIRELY by persisted snapshots, never by recomputing "what Study probably changed"
 * (FLOW.md §6). That is why a capability which never executed is never restored: no row was
 * written for it, so there is nothing to walk. `ringer` reporting `not_supported` at apply time
 * simply does not appear here, and nothing has to special-case it.
 *
 * One failure never aborts the walk — a phone that refuses to put brightness back must still get
 * its Do Not Disturb turned off.
 *
 * Snapshots are NOT cleared here even on success. Deleting them is a database write, which this
 * layer must not perform, and keeping them is what makes a partial restore retryable. The caller
 * inspects `summariseRestore()` and calls `SnapshotStore.clear()` only on a clean sweep (ADR-117).
 */
export async function restoreSession(
  sessionId: string,
  deps: RestoreDeps,
): Promise<ActionResult[]> {
  const { registry, snapshots, onProgress } = deps;
  const rows = lifoOrder(await snapshots.forSession(sessionId));

  const results: ActionResult[] = [];

  for (const [index, row] of rows.entries()) {
    const emit = (phase: ActionPhase, result: ActionResult | null): void =>
      onProgress?.({
        index,
        capability: row.capability,
        phase,
        result,
        declaredPermissionMismatch: false,
      });

    emit('pending', null);
    emit('running', null);

    const settle = (result: ActionResult): void => {
      results.push(result);
      emit('settled', result);
    };

    // A row with no previous value is a capability that had nothing restorable when it was
    // applied. Never written by executePlan(), but a stored row is user data and gets a truthful
    // answer rather than a guess.
    if (row.previousValue === null) {
      settle(resultFor(row.capability, 'skipped', 'There was no earlier value to put back.', null));
      continue;
    }

    if (!isCapability(row.capability)) {
      settle(
        resultFor(
          row.capability,
          'not_supported',
          `Ally does not know how to change "${String(row.capability)}".`,
        ),
      );
      continue;
    }

    let capability: DeviceCapability;
    try {
      capability = registry.get(row.capability);
    } catch {
      settle(
        resultFor(row.capability, 'not_supported', 'This is not available on your phone.', null),
      );
      continue;
    }

    try {
      if (!(await capability.isAvailable())) {
        settle(
          resultFor(row.capability, 'not_supported', 'This is not available on your phone.', null),
        );
        continue;
      }

      // Same gate as apply, for the same reason: a denied permission must leave the device
      // untouched rather than half-restored.
      const required = await capability.requiredPermissions();
      const missing = required.filter((p) => !p.granted);
      if (missing.length > 0) {
        const current = await capability.snapshot();
        settle({
          capability: row.capability,
          status: 'permission_needed',
          beforeValue: current,
          afterValue: current,
          message: `${missing[0]?.label ?? 'A permission'} is needed before Ally can change this.`,
        });
        continue;
      }

      settle(await capability.restore(row.previousValue));
    } catch (e) {
      settle(
        resultFor(
          row.capability,
          'failed',
          e instanceof Error ? e.message : 'This change did not go through.',
        ),
      );
    }
  }

  return results;
}
