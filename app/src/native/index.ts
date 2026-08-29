/**
 * OWNER: AAYUSH
 *
 * Selects the device backend. This is the seam that keeps Shlok and Dhrey unblocked (ADR-007):
 * with the Kotlin module present we drive the real phone, without it we drive MockDevice, and
 * everything above this file is identical either way.
 *
 * The active backend is exposed as `device.backend` and MUST be surfaced in the UI so a mock is
 * never mistaken for a real device action.
 */

import type { DeviceRegistry } from '../types';
import { mockRegistry } from './MockDevice';

/**
 * PHASE 1 (Aayush): replace this with the real lookup once `modules/ally-native` exists:
 *
 *   import { requireOptionalNativeModule } from 'expo-modules-core';
 *   const native = requireOptionalNativeModule('AllyNative');
 *   return native ? createNativeRegistry(native) : null;
 *
 * Returning null here means "no native module on this runtime", which is the correct answer
 * on an emulator, in Node during unit tests, and until the module ships.
 */
function resolveNativeRegistry(): DeviceRegistry | null {
  return null;
}

export const device: DeviceRegistry = resolveNativeRegistry() ?? mockRegistry;

export const isMockBackend = device.backend === 'mock';

export { mockRegistry };
