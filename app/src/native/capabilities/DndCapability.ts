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

  /**
   * Shared by execute() and restore(). Same ladder, two differences: the success label, and
   * WHICH native call moves the filter — `dndApply` asserts Ally's rule, `dndRelease` stands it
   * down (ADR-123). Everything before that point is identical on purpose, so a restore cannot
   * skip an availability or permission check that an apply performs.
   */
  const applyMode = (
    value: CapabilityValue,
    successStatus: 'applied' | 'restored',
    move: (mode: DndMode) => ReturnType<AllyNativeSpec['dndApply']> = (m) => native.dndApply(m),
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
      res = move(value);
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

    /**
     * Restores the interruption filter AND the notification policy.
     *
     * Both are user state Ally borrowed, and the policy is given back FIRST so that the
     * filter change lands on top of the user's own policy rather than Ally's. It is restored
     * unconditionally, not only when returning to `off`: a user who already had Do Not
     * Disturb on before the context used to get their mode back and silently keep Ally's
     * priority policy (ADR-120).
     *
     * A policy that will not go back does not stop the mode going back — the same
     * "one failure never aborts the walk" rule the executor follows. `nothing_saved` is the
     * normal case for a context that never touched priority.
     *
     * The filter goes back through `dndRelease`, NOT `dndApply` (ADR-123). Re-applying the
     * snapshotted mode would rebuild and re-activate Ally's own zen rule for any mode other
     * than "off" — which reads back as a perfect restore while quietly leaving the user's
     * phone in Do Not Disturb on Ally's authority, with the snapshots cleared and nothing left
     * to turn it off. Releasing hands the filter back to whatever the user had underneath.
     */
    async restore(previous) {
      try {
        native.dndRestorePolicy();
      } catch {
        // Reported by the native side as a retained saved policy; the mode still goes back.
      }
      return applyMode(previous, 'restored', (mode) => native.dndRelease(mode));
    },
  };
}
