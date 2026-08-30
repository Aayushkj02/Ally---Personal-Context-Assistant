/**
 * OWNER: AAYUSH — task T3
 *
 * Real DND capability, backed by DndController.kt (AutomaticZenRule — ADR-102 rung 1).
 *
 * The order below is the safety ladder and is deliberate:
 *   available? -> permission? -> snapshot -> apply -> READ-BACK -> report
 *
 * Two rules this file exists to enforce:
 *   1. A denied permission returns `permission_needed` with NO mutation attempted.
 *   2. `applied` is only ever returned when the native side confirmed by reading the
 *      device state back. Anything else is failed / not_supported (PRD 20, NFR-03).
 */

import type { ActionResult, CapabilityValue, DeviceCapability, DndMode } from '../../types';
import { DND_MODES } from '../../types';
import type { AllyNativeSpec } from '../../../modules/ally-native';
import { describePermission } from '../permissions';

function isDndMode(value: unknown): value is DndMode {
  return typeof value === 'string' && (DND_MODES as readonly string[]).includes(value);
}

function fail(
  status: ActionResult['status'],
  message: string,
  before: CapabilityValue | null,
): ActionResult {
  return { capability: 'dnd', status, beforeValue: before, afterValue: before, message };
}

export function createDndCapability(native: AllyNativeSpec): DeviceCapability {
  /** Reads the effective mode, or null when the platform cannot tell us. */
  const readMode = (): DndMode | null => {
    try {
      const mode = native.dndGetMode();
      return isDndMode(mode) ? mode : null;
    } catch {
      return null;
    }
  };

  /** Shared by execute() and restore() — same ladder, only the success label differs. */
  const applyMode = (
    value: CapabilityValue,
    successStatus: 'applied' | 'restored',
  ): ActionResult => {
    if (!isDndMode(value)) {
      return fail('failed', `"${String(value)}" is not a Do Not Disturb mode.`, readMode());
    }

    let available = false;
    try {
      available = native.dndIsAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      return fail('not_supported', 'Do Not Disturb control is not available on this device.', null);
    }

    // Checked before the mutation, never after.
    if (!native.getPermissionStatus('notification_policy')) {
      return fail(
        'permission_needed',
        'Do Not Disturb access is needed before Ally can change this.',
        readMode(),
      );
    }

    let res;
    try {
      res = native.dndApply(value);
    } catch (e) {
      return fail(
        'failed',
        e instanceof Error ? e.message : 'Do Not Disturb change failed.',
        readMode(),
      );
    }

    const before = isDndMode(res.before) ? res.before : null;
    const after = isDndMode(res.after) ? res.after : null;

    if (res.ok) {
      return {
        capability: 'dnd',
        status: successStatus,
        beforeValue: before,
        afterValue: after,
        // Surface which ADR-102 rung worked — the spike's whole point is knowing this.
        message: `${res.message} [${res.rung}]`,
      };
    }

    // Map the native reason onto the truthful-status vocabulary.
    const status: ActionResult['status'] =
      res.reason === 'permission'
        ? 'permission_needed'
        : res.reason === 'unsupported'
          ? 'not_supported'
          : 'failed';

    return {
      capability: 'dnd',
      status,
      beforeValue: before,
      afterValue: after,
      message: res.message,
    };
  };

  return {
    async isAvailable() {
      try {
        return native.dndIsAvailable();
      } catch {
        return false;
      }
    },

    async requiredPermissions() {
      return [
        describePermission(
          'notification_policy',
          native.getPermissionStatus('notification_policy'),
        ),
      ];
    },

    async snapshot() {
      return readMode();
    },

    async execute(value) {
      return applyMode(value, 'applied');
    },

    async restore(previous) {
      return applyMode(previous, 'restored');
    },
  };
}
