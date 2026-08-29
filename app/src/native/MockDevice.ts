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

/** Simulated device state. Starts at plausible "normal phone" values. */
interface MockState {
  dnd: DndMode;
  brightness: number;
  ringer: RingerMode;
  alarm: string | null;
  /** Flip these to exercise the permission-blocked UI without touching a real device. */
  permissions: Record<PermissionRequirement['key'], boolean>;
}

const state: MockState = {
  dnd: 'off',
  brightness: 80,
  ringer: 'normal',
  alarm: null,
  permissions: {
    notification_policy: true,
    write_settings: true,
    microphone: true,
    exact_alarm: true,
  },
};

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
  state.brightness = 80;
  state.ringer = 'normal';
  state.alarm = null;
  state.permissions = {
    notification_policy: true,
    write_settings: true,
    microphone: true,
    exact_alarm: true,
  };
}

function permission(key: PermissionRequirement['key']): PermissionRequirement {
  return { ...PERMISSION_LABELS[key], granted: state.permissions[key] };
}

function blocked(capability: Capability, key: PermissionRequirement['key']): ActionResult {
  return {
    capability,
    status: 'permission_needed',
    beforeValue: null,
    afterValue: null,
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
      if (!state.permissions[permissionKey]) return blocked(capability, permissionKey);

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
      if (!state.permissions[permissionKey]) return blocked(capability, permissionKey);

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

const brightness = makeCapability(
  'brightness',
  'brightness',
  'write_settings',
  (v) => `Brightness set to ${v}%.`,
);

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
    if (!state.permissions.exact_alarm) return blocked('alarm', 'exact_alarm');
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
