/**
 * OWNER: AAYUSH
 *
 * In-memory implementation of the native device surface.
 *
 * WHY THIS EXISTS: Shlok and Dhrey must never wait on the Kotlin build. This mock
 * implements `DeviceCapability` identically to the real module, so the whole app —
 * policy engine, screens, restore flow — runs on any phone, emulator or Node process.
 *
 * RULE: when the real native module changes shape, this file changes in the SAME commit.
 * Parity is the entire point; a drifted mock is worse than no mock.
 */

import type {
  ActionResult,
  Capability,
  CapabilityValue,
  DeviceCapability,
  DeviceRegistry,
  DndMode,
  PermissionRequirement,
  RingerMode,
} from '../types';
import { PERMISSION_LABELS } from './permissions';

/** Android's SCREEN_BRIGHTNESS range, so the mock loses the same rounding the real device does. */
const RAW_MAX = 255;
const toPercent = (raw: number): number => Math.round((raw * 100) / RAW_MAX);
const toRaw = (percent: number): number => Math.round((percent * RAW_MAX) / 100);

/**
 * Simulated device state. Starts at plausible "normal phone" values.
 *
 * `brightnessRaw` is the source of truth and `brightness` is derived from it, exactly as on the
 * phone. Modelling both is what lets the mock reproduce the ADR-116 failure: raw 187 reports as
 * 73%, and 73% converts back to 186. A mock that stored only the percent could never show that.
 */
interface MockState {
  dnd: DndMode;
  brightnessRaw: number;
  ringer: RingerMode;
  alarm: string | null;
  /** Flip these to exercise the permission-blocked UI without touching a real device. */
  permissions: Record<PermissionRequirement['key'], boolean>;
}

const DEFAULT_RAW = 187;

const state: MockState = {
  dnd: 'off',
  brightnessRaw: DEFAULT_RAW,
  ringer: 'normal',
  alarm: null,
  permissions: {
    notification_policy: true,
    write_settings: true,
    microphone: true,
    exact_alarm: true,
  },
};

/**
 * Stands in for the SharedPreferences that BrightnessController writes (ADR-116).
 *
 * The distinction this models is the whole point of A-V2: `state` is the DEVICE and survives the
 * app dying; this is ALLY'S MEMORY and survives only because it is on disk. Anything the real
 * controller keeps in the heap would be gone after __simulateProcessDeath(), so a test that
 * restores exactly across that call is proving the memory is genuinely durable.
 */
const prefs = new Map<string, number>();

const rawKey = (percent: number): string => `raw_${percent}`;

function rememberRaw(percent: number, raw: number): void {
  prefs.set(rawKey(percent), raw);
}

function recallRaw(percent: number): number | null {
  return prefs.get(rawKey(percent)) ?? null;
}

/** Test hook: force a permission off to preview the blocked state in the UI. */
export function __setMockPermission(key: PermissionRequirement['key'], granted: boolean): void {
  state.permissions[key] = granted;
}

/** Test hook: read the simulated device state in unit tests. */
export function __getMockState(): Readonly<MockState> {
  return state;
}

export function __resetMockState(): void {
  state.dnd = 'off';
  state.brightnessRaw = DEFAULT_RAW;
  state.ringer = 'normal';
  state.alarm = null;
  state.permissions = {
    notification_policy: true,
    write_settings: true,
    microphone: true,
    exact_alarm: true,
  };
  prefs.clear();
}

/** Test hook: the device's true raw brightness, which the percent contract cannot express. */
export function __getMockBrightnessRaw(): number {
  return state.brightnessRaw;
}

/** Test hook: what the percent contract would report for the device's current raw value. */
export function __getMockBrightnessPercent(): number {
  return toPercent(state.brightnessRaw);
}

/** Test hook: place the device at a specific raw value, as a real phone would already be. */
export function __setMockBrightnessRaw(raw: number): void {
  state.brightnessRaw = raw;
}

/**
 * Test hook: the app process dies and comes back.
 *
 * Wipes everything a real restart would wipe — module-level heap caches — while leaving BOTH
 * `state` (the device's own settings, which Android keeps) and `prefs` (on disk) untouched.
 * There is deliberately no heap cache of snapshot data to clear here, and that is the invariant
 * this hook exists to guard: if snapshot memory ever moves back into the heap, the restore-
 * after-process-death test starts failing instead of silently returning a value one raw unit off.
 */
export function __simulateProcessDeath(): void {
  // Nothing to clear today. Any future module-level cache belongs here, not in `prefs`.
}

function permission(key: PermissionRequirement['key']): PermissionRequirement {
  return { ...PERMISSION_LABELS[key], granted: state.permissions[key] };
}

/**
 * PARITY (ADR-007): the native backend reports the CURRENT value on both sides of a blocked
 * call, so the UI can render "priority -> priority" as visible proof nothing moved. The mock
 * must do the same or the two backends disagree on the shape of a denial.
 */
function blocked(
  capability: Capability,
  key: PermissionRequirement['key'],
  current: CapabilityValue | null,
): ActionResult {
  return {
    capability,
    status: 'permission_needed',
    beforeValue: current,
    afterValue: current,
    message: `${PERMISSION_LABELS[key].label} is needed before Ally can change this.`,
  };
}

/**
 * Builds a capability backed by a single field of the mock state.
 * Mirrors the real module's contract: execute() writes, then reads back to verify.
 */
function makeCapability<K extends keyof MockState>(
  capability: Capability,
  field: K,
  permissionKey: PermissionRequirement['key'],
  describe: (value: CapabilityValue) => string,
): DeviceCapability {
  return {
    async isAvailable() {
      return true;
    },

    async requiredPermissions() {
      return [permission(permissionKey)];
    },

    async snapshot() {
      return state[field] as CapabilityValue | null;
    },

    async execute(value) {
      if (!state.permissions[permissionKey]) {
        return blocked(capability, permissionKey, state[field] as CapabilityValue | null);
      }

      const before = state[field] as CapabilityValue | null;
      state[field] = value as MockState[K];
      const after = state[field] as CapabilityValue;

      // Read-back verification, exactly as the real module must do.
      // Never report `applied` on a write we did not confirm.
      if (after !== value) {
        return {
          capability,
          status: 'failed',
          beforeValue: before,
          afterValue: after,
          message: 'The setting did not take effect.',
        };
      }

      return {
        capability,
        status: 'applied',
        beforeValue: before,
        afterValue: after,
        message: describe(value),
      };
    },

    async restore(previous) {
      if (!state.permissions[permissionKey]) {
        return blocked(capability, permissionKey, state[field] as CapabilityValue | null);
      }

      const before = state[field] as CapabilityValue | null;
      state[field] = previous as MockState[K];

      return {
        capability,
        status: 'restored',
        beforeValue: before,
        afterValue: previous,
        message: describe(previous),
      };
    },
  };
}

const dnd = makeCapability('dnd', 'dnd', 'notification_policy', (v) =>
  v === 'off' ? 'Interruptions back to normal.' : `Interruptions set to ${v}.`,
);

/**
 * Brightness cannot use makeCapability: the contract currency is a PERCENT but the device stores
 * a RAW value, and the whole of ADR-116 lives in the gap between them. This mirrors
 * BrightnessController.kt step for step so the semantics can be tested without a phone.
 */
const brightness: DeviceCapability = {
  async isAvailable() {
    return true;
  },

  async requiredPermissions() {
    return [permission('write_settings')];
  },

  /** Reading needs no permission. Returns the percent AND remembers the exact raw value. */
  async snapshot() {
    const percent = toPercent(state.brightnessRaw);
    rememberRaw(percent, state.brightnessRaw);
    return percent;
  },

  async execute(value) {
    if (!state.permissions.write_settings) {
      return blocked('brightness', 'write_settings', toPercent(state.brightnessRaw));
    }

    const before = toPercent(state.brightnessRaw);
    state.brightnessRaw = toRaw(Number(value));
    const after = toPercent(state.brightnessRaw);

    if (after !== Number(value)) {
      return {
        capability: 'brightness',
        status: 'failed',
        beforeValue: before,
        afterValue: after,
        message: 'The setting did not take effect.',
      };
    }

    return {
      capability: 'brightness',
      status: 'applied',
      beforeValue: before,
      afterValue: after,
      message: `Brightness set to ${after}%.`,
    };
  },

  /**
   * Writes back the EXACT raw value captured at snapshot time. Falling back to toRaw() is a
   * genuine last resort — it is the path that returns 186 where the user had 187.
   */
  async restore(previous) {
    if (!state.permissions.write_settings) {
      return blocked('brightness', 'write_settings', toPercent(state.brightnessRaw));
    }

    const percent = Number(previous);
    const before = toPercent(state.brightnessRaw);
    state.brightnessRaw = recallRaw(percent) ?? toRaw(percent);

    return {
      capability: 'brightness',
      status: 'restored',
      beforeValue: before,
      afterValue: toPercent(state.brightnessRaw),
      message: `Brightness set to ${percent}%.`,
    };
  },
};

const ringer = makeCapability(
  'ringer',
  'ringer',
  'notification_policy',
  (v) => `Ringer set to ${v}.`,
);

/**
 * Alarm is one-shot: it schedules rather than mutating a restorable setting.
 * snapshot() returns null and restore() is a no-op — the action engine must not
 * try to "un-set" an alarm the user asked for.
 */
const alarm: DeviceCapability = {
  async isAvailable() {
    return true;
  },
  async requiredPermissions() {
    return [permission('exact_alarm')];
  },
  async snapshot() {
    return null;
  },
  async execute(value) {
    if (!state.permissions.exact_alarm) return blocked('alarm', 'exact_alarm', null);
    state.alarm = String(value);
    return {
      capability: 'alarm',
      status: 'applied',
      beforeValue: null,
      afterValue: value,
      message: `Alarm set for ${value}.`,
    };
  },
  async restore() {
    return {
      capability: 'alarm',
      status: 'skipped',
      beforeValue: null,
      afterValue: null,
      message: 'Alarms are left in place when a context ends.',
    };
  },
};

const registry: Record<Capability, DeviceCapability> = { dnd, brightness, ringer, alarm };

export const mockRegistry: DeviceRegistry = {
  backend: 'mock',
  get(capability) {
    return registry[capability];
  },
  async openSettingsFor(key) {
    // eslint-disable-next-line no-console
    console.log(`[MockDevice] would open Android settings for: ${key}`);
  },
};
