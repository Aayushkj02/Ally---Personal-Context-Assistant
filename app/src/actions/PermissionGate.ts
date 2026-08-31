/**
 * OWNER: AAYUSH — tasks T6, A-V1
 *
 * Checks required Android permissions BEFORE any protected operation (SRS FR-12).
 * A missing permission yields ActionResult{ permission_needed } and NO mutation is
 * attempted — the device must never be left half-changed.
 *
 * WHICH SOURCE OF TRUTH (ADR-115):
 * A `PlannedAction` carries `requiredPermission`, which Dhrey's planner copies from its
 * `PERMISSION_MAP` at policy time. A `DeviceCapability` reports `requiredPermissions()`,
 * read live from the phone. Only the second one knows whether the user has actually
 * granted anything, so the capability is authoritative and the gate reads it exclusively.
 * The plan's field is kept as a cross-check: when the two disagree we flag it on the
 * progress channel rather than silently preferring one, because a disagreement means
 * policy and device have drifted apart. (They agree today — I verified every entry of
 * PERMISSION_MAP against what each capability reports.)
 */

import type {
  ActionResult,
  CapabilityValue,
  DeviceCapability,
  PermissionRequirement,
  PlannedAction,
} from '../types';

export interface PermissionCheck {
  granted: boolean;
  /** Permissions the capability reports as required and not yet granted. */
  missing: PermissionRequirement[];
  /**
   * True when the plan declared a permission the capability does not list at all.
   * Never changes the gate's verdict — it is a drift signal for us, not for the user.
   */
  declaredMismatch: boolean;
}

export async function checkPermissions(
  capability: DeviceCapability,
  action: PlannedAction,
): Promise<PermissionCheck> {
  const required = await capability.requiredPermissions();
  const missing = required.filter((p) => !p.granted);
  const declared = action.requiredPermission;

  return {
    granted: missing.length === 0,
    missing,
    declaredMismatch: declared !== null && !required.some((p) => p.key === declared),
  };
}

/**
 * The standard blocked row. `beforeValue` and `afterValue` are both the CURRENT value, so
 * the UI can render "priority → priority" as visible proof nothing moved (ADR-007 parity).
 */
export function permissionNeededResult(
  action: PlannedAction,
  check: PermissionCheck,
  current: CapabilityValue | null,
): ActionResult {
  const label = check.missing[0]?.label ?? 'A permission';

  return {
    capability: action.capability,
    status: 'permission_needed',
    beforeValue: current,
    afterValue: current,
    message: `${label} is needed before Ally can change this.`,
  };
}
