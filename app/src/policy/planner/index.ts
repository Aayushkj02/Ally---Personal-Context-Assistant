import type { Capability, CapabilityValue, PermissionRequirement } from '../../types/capability';
import type { DeviceSnapshot } from '../../types/models';
import type { ActionPlan, PlannedAction, ResolvedPolicy } from '../../types/policy';
import type { Persistence, IntentSchedule } from '../../types/intent';

const PERMISSION_MAP: Record<Capability, PermissionRequirement['key'] | null> = {
  dnd: 'notification_policy',
  ringer: 'notification_policy',
  brightness: 'write_settings',
  alarm: 'exact_alarm',
};

/**
 * ActionPlanner: ResolvedPolicy -> ActionPlan.
 * Maps resolved capabilities into actionable steps for the native layer.
 */
export function buildActionPlan(
  sessionId: string,
  policy: ResolvedPolicy,
  persistence: Persistence,
  schedule?: IntentSchedule | null,
): ActionPlan {
  // We need to restore state if this is not a permanent change
  const restoreOnEnd =
    persistence === 'session' || persistence === 'temporary' || persistence === 'unspecified';

  const actions: PlannedAction[] = policy.entries.map((entry) => ({
    capability: entry.capability,
    value: entry.value,
    needsSnapshot: restoreOnEnd, // take snapshot so we can restore it later
    requiredPermission: PERMISSION_MAP[entry.capability],
    reason: entry.reason,
  }));

  if (schedule && schedule.kind !== 'none' && schedule.time) {
    actions.push({
      capability: 'alarm',
      value: schedule.time,
      needsSnapshot: false,
      requiredPermission: 'exact_alarm',
      reason: 'from your command',
    });
  }

  return {
    sessionId,
    actions,
    restoreOnEnd,
  };
}

/**
 * RestorePlanner: DeviceSnapshot[] -> ActionPlan (D3.3).
 *
 * Turns the originals captured before a context into a plan that puts them back. Pure
 * and deterministic, exactly like buildActionPlan, and it produces the SAME frozen
 * ActionPlan the executor already consumes — there is no second plan type.
 *
 * Two fields differ from a forward plan, and both matter:
 *   needsSnapshot false  Snapshotting mid-restore would capture the CONTEXT's values
 *                        as if they were the originals, destroying the real ones.
 *   restoreOnEnd  false  Putting settings back is not itself a context to undo later.
 *
 * A snapshot whose previousValue is null is EXCLUDED rather than defaulted:
 * PlannedAction.value is CapabilityValue and cannot hold null, and guessing a value
 * the user never had is worse than leaving the capability alone. Callers see those rows
 * via RestorationTarget.unavailable.
 */
export function buildRestorePlan(sessionId: string, snapshots: DeviceSnapshot[]): ActionPlan {
  const actions: PlannedAction[] = snapshots
    .filter((snapshot) => snapshot.previousValue !== null)
    .map((snapshot) => ({
      capability: snapshot.capability,
      value: snapshot.previousValue as CapabilityValue,
      needsSnapshot: false,
      requiredPermission: PERMISSION_MAP[snapshot.capability],
      reason: 'restoring the value from before this context',
    }));

  return {
    sessionId,
    actions,
    restoreOnEnd: false,
  };
}
