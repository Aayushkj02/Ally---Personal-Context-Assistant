/**
 * OWNER: AAYUSH — tasks T3 (DND), T4 (brightness), T5 (alarm)
 *
 * Real, native-backed DeviceCapability implementations.
 *
 * T2 STATE: the boundary exists, permission reporting is REAL, but no capability
 * mutates the device yet. Each one is a `pendingCapability` that answers
 * `isAvailable() === false` and returns `not_supported` from execute/restore.
 *
 * That is deliberate and is the whole point of the architecture: an unimplemented
 * capability must say so out loud. A truthful "not supported on this device" scores
 * better than a fake success (PRD 20 / NFR-03), and it means the action engine, the
 * policy layer and the UI can all be exercised end-to-end before T3 lands.
 *
 * T3/T4 replace one entry at a time. PARITY OBLIGATION (ADR-007): whatever changes
 * here changes in ../MockDevice.ts in the SAME commit.
 */

import type {
  ActionResult,
  Capability,
  CapabilityValue,
  DeviceCapability,
  PermissionRequirement,
} from '../../types';
import type { AllyNativeSpec } from '../../../modules/ally-native';
import { describePermission } from '../permissions';

/**
 * A capability whose native implementation has not landed yet.
 * Reports permissions honestly; refuses to pretend it can act.
 */
export function pendingCapability(
  capability: Capability,
  permissionKey: PermissionRequirement['key'],
  native: AllyNativeSpec,
  taskId: string,
): DeviceCapability {
  const unsupported = (): ActionResult => ({
    capability,
    status: 'not_supported',
    beforeValue: null,
    afterValue: null,
    message: `Ally cannot change this yet (${taskId} not implemented).`,
  });

  return {
    async isAvailable() {
      return false;
    },

    async requiredPermissions() {
      return [describePermission(permissionKey, native.getPermissionStatus(permissionKey))];
    },

    async snapshot(): Promise<CapabilityValue | null> {
      return null;
    },

    async execute() {
      return unsupported();
    },

    async restore() {
      return unsupported();
    },
  };
}

/** Builds the full native capability set. T3/T4/T5 swap entries out of `pendingCapability`. */
export function createNativeCapabilities(
  native: AllyNativeSpec,
): Record<Capability, DeviceCapability> {
  return {
    dnd: pendingCapability('dnd', 'notification_policy', native, 'T3'),
    brightness: pendingCapability('brightness', 'write_settings', native, 'T4'),
    ringer: pendingCapability('ringer', 'notification_policy', native, 'T3'),
    alarm: pendingCapability('alarm', 'exact_alarm', native, 'T5'),
  };
}
