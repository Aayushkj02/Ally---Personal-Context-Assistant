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
import type { BorrowedPolicy } from '../actions/executors';
import {
  createNativeRegistry,
  createBorrowedPolicy,
  getNativeDeviceInfo,
  runDndProbe,
  setPriorityCallers,
  applyPriorityPreferences,
  analyseCallLog,
  withAlarmContext,
  dismissAllyAlarm,
  showClockAlarms,
  alarmDebugState,
} from './AllyNative';
import { mockRegistry, mockBorrowedPolicy } from './MockDevice';

export const device: DeviceRegistry = createNativeRegistry() ?? mockRegistry;

/**
 * The user's own notification policy, from whichever backend is live (ADR-125).
 *
 * Selected here, beside the registry, so the two can never disagree about which phone they are
 * talking to. Restore has to be able to give this back even when no `dnd` action was planned,
 * because priority rewrites it from outside the ActionPlan.
 */
export const borrowedPolicy: BorrowedPolicy = createBorrowedPolicy() ?? mockBorrowedPolicy;

export const isMockBackend = device.backend === 'mock';

export {
  getNativeDeviceInfo,
  runDndProbe,
  setPriorityCallers,
  applyPriorityPreferences,
  analyseCallLog,
  withAlarmContext,
  dismissAllyAlarm,
  showClockAlarms,
  alarmDebugState,
  mockRegistry,
};
export type { AlarmContext } from './capabilities/AlarmCapability';
