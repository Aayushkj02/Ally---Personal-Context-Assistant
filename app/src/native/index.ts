/**
 * OWNER: AAYUSH
 *
 * Selects the device backend. This is the seam that keeps Shlok and Dhrey unblocked
 * (ADR-007): with the Kotlin module present we drive the real phone, without it we
 * drive MockDevice, and everything above this file is identical either way.
 *
 * The active backend is exposed as `device.backend` and MUST be surfaced in the UI so
 * a mock is never mistaken for a real device action.
 */

import type { DeviceRegistry } from '../types';
import { createNativeRegistry, getNativeDeviceInfo, runDndProbe } from './AllyNative';
import { mockRegistry } from './MockDevice';

export const device: DeviceRegistry = createNativeRegistry() ?? mockRegistry;

export const isMockBackend = device.backend === 'mock';

export { getNativeDeviceInfo, runDndProbe, mockRegistry };
