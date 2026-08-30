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
