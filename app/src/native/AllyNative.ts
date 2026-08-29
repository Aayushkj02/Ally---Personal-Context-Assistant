/**
 * OWNER: AAYUSH — task T2
 *
 * Adapts the AllyNative Kotlin module to the frozen DeviceRegistry contract.
 * Returns null when the native module is absent, which is the signal for
 * src/native/index.ts to fall back to MockDevice.
 */

import type { Capability, DeviceCapability, DeviceRegistry, PermissionRequirement } from '../types';
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
