/**
 * OWNER: AAYUSH — task T4
 *
 * Real brightness capability, backed by BrightnessController.kt.
 *
 * Same safety ladder as DND, same rule: `applied` only after a read-back confirms it.
 * A denied WRITE_SETTINGS returns `permission_needed` with no write attempted.
 *
 * RESTORATION IS EXACT. The contract carries brightness as an integer percent, but the
 * native side remembers the precise raw Settings.System value captured at snapshot time and
 * writes that back — so a phone at raw 187 returns to 187, not to a value re-derived from
 * "73%". It also restores the user's adaptive-brightness mode, which would otherwise be
 * silently left on manual.
 */

import type { ActionResult, CapabilityValue, DeviceCapability } from '../../types';
import type { AllyNativeSpec } from '../../../modules/ally-native';
import { describePermission } from '../permissions';

function toPercent(value: CapabilityValue): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : null;
}

export function createBrightnessCapability(native: AllyNativeSpec): DeviceCapability {
  const readPercent = (): number | null => {
    try {
      const s = native.brightnessSnapshot();
      return s.ok ? s.percent : null;
    } catch {
      return null;
    }
  };

  const run = (
    value: CapabilityValue,
    successStatus: 'applied' | 'restored',
    fn: (p: number) => ReturnType<AllyNativeSpec['brightnessApply']>,
  ): ActionResult => {
    const percent = toPercent(value);
    if (percent === null) {
      return {
        capability: 'brightness',
        status: 'failed',
        beforeValue: readPercent(),
        afterValue: readPercent(),
        message: `"${String(value)}" is not a brightness percentage.`,
      };
    }

    let available = false;
    try {
      available = native.brightnessIsAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      return {
        capability: 'brightness',
        status: 'not_supported',
        beforeValue: null,
        afterValue: null,
        message: 'Brightness control is not available on this device.',
      };
    }

    // Checked before the write, never after.
    if (!native.getPermissionStatus('write_settings')) {
      const current = readPercent();
      return {
        capability: 'brightness',
        status: 'permission_needed',
        beforeValue: current,
        afterValue: current,
        message:
          'Permission to modify system settings is needed before Ally can change brightness.',
      };
    }

    let res;
    try {
      res = fn(percent);
    } catch (e) {
      const current = readPercent();
      return {
        capability: 'brightness',
        status: 'failed',
        beforeValue: current,
        afterValue: current,
        message: e instanceof Error ? e.message : 'Brightness change failed.',
      };
    }

    const status: ActionResult['status'] = res.ok
      ? successStatus
      : res.reason === 'permission'
        ? 'permission_needed'
        : res.reason === 'unsupported'
          ? 'not_supported'
          : 'failed';

    return {
      capability: 'brightness',
      status,
      beforeValue: res.before === null ? null : Number(res.before),
      afterValue: res.after === null ? null : Number(res.after),
      message: res.message,
    };
  };

  return {
    async isAvailable() {
      try {
        return native.brightnessIsAvailable();
      } catch {
        return false;
      }
    },

    async requiredPermissions() {
      return [describePermission('write_settings', native.getPermissionStatus('write_settings'))];
    },

    async snapshot() {
      return readPercent();
    },

    async execute(value) {
      return run(value, 'applied', (p) => native.brightnessApply(p));
    },

    async restore(previous) {
      return run(previous, 'restored', (p) => native.brightnessRestore(p));
    },
  };
}
