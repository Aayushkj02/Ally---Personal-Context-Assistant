/**
 * OWNER: AAYUSH — task T2
 *
 * Adapts the AllyNative Kotlin module to the frozen DeviceRegistry contract.
 * Returns null when the native module is absent, which is the signal for
 * src/native/index.ts to fall back to MockDevice.
 */

import type {
  Capability,
  ChannelEnforcement,
  DeviceCapability,
  DeviceRegistry,
  PermissionRequirement,
} from '../types';
import AllyNative, { type AllyNativeDeviceInfo } from '../../modules/ally-native';
import { createNativeCapabilities } from './capabilities';

export function createNativeRegistry(): DeviceRegistry | null {
  if (!AllyNative) return null;

  const native = AllyNative;
  const capabilities: Record<Capability, DeviceCapability> = createNativeCapabilities(native);

  return {
    backend: 'native',
    get(capability) {
      return capabilities[capability];
    },
    async openSettingsFor(key: PermissionRequirement['key']) {
      native.openSettingsFor(key);
    },
  };
}

/**
 * Device facts, or null on the mock backend. T3 needs `targetSdk` to pick the DND rung:
 * Android restricts direct DND control for apps TARGETING API 35+, so the app's own
 * target matters more than the device's OS version (ADR-102).
 */
export function getNativeDeviceInfo(): AllyNativeDeviceInfo | null {
  return AllyNative ? AllyNative.getDeviceInfo() : null;
}

/**
 * Runs the demo-device compatibility probe, or returns null on the mock backend.
 * Reports which ADR-102 rung works and whether the priority-caller demo is possible.
 */
export function runDndProbe(): Record<string, unknown> | null {
  return AllyNative ? AllyNative.dndProbe() : null;
}

/**
 * Applies the priority preferences Android can actually enforce.
 *
 * `whatsapp` is accepted so callers can pass a whole preference set, but it is NEVER sent to
 * Android — no public API grants another app's notifications a DND bypass. The returned
 * `whatsappEnforceable: false` is what the UI must surface (ADR-111).
 */
export function applyPriorityPreferences(prefs: {
  calls: boolean;
  sms: boolean;
  whatsapp?: boolean;
  repeatCallers?: boolean;
}): { ok: boolean; channels: ChannelEnforcement[] } | null {
  if (!AllyNative) return null;

  const raw = AllyNative.dndSetPriority(prefs.calls, prefs.repeatCallers ?? true, prefs.sms);
  const rows = Array.isArray(raw.channels) ? (raw.channels as Record<string, unknown>[]) : [];

  const channels: ChannelEnforcement[] = rows.map((r) => ({
    channel: String(r.channel) as ChannelEnforcement['channel'],
    status: String(r.status) as ChannelEnforcement['status'],
    message: String(r.message),
  }));

  return { ok: raw.ok === true, channels };
}

/** Priority-caller exception + Android's repeat-caller bypass (ADR-107). */
export function setPriorityCallers(
  allowStarred: boolean,
  allowRepeatCallers: boolean,
): Record<string, unknown> | null {
  return AllyNative ? AllyNative.dndSetPriorityCallers(allowStarred, allowRepeatCallers) : null;
}

/**
 * Repeated-caller DETECTION: 4+ calls from one caller in a rolling 10 minutes.
 * Reports only — it never changes DND and never makes anything ring (ADR-109).
 */
export function analyseCallLog(): Record<string, unknown> | null {
  return AllyNative ? AllyNative.callLogAnalyse() : null;
}
