import type { Capability, PermissionRequirement } from '../../types/capability';
import type { ActionPlan, PlannedAction, ResolvedPolicy } from '../../types/policy';
import type { Persistence } from '../../types/intent';

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

  return {
    sessionId,
    actions,
    restoreOnEnd,
  };
}
