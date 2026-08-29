/**
 * OWNER: AAYUSH — task T2
 *
 * Raw accessor for the AllyNative Kotlin module. This is the ONLY place that reaches
 * across the bridge; everything above it works with the DeviceCapability contract.
 *
 * `requireOptionalNativeModule` returns null when the module is absent — on an emulator
 * without the dev build, in Expo Go, or in a Node test process. That null is what makes
 * the mock fallback in src/native/index.ts work (ADR-007).
 */

import { requireOptionalNativeModule } from 'expo';

export interface AllyNativeDeviceInfo {
  manufacturer: string;
  model: string;
  /** Device OS API level. */
  sdkInt: number;
  release: string;
  /**
   * The APP's target SDK, which is what decides whether legacy DND control is still
   * permitted — not the device's OS version. See ADR-102.
   */
  targetSdk: number;
}

export type AllyPermissionKey =
  'notification_policy' | 'write_settings' | 'exact_alarm' | 'microphone';

export interface AllyNativeSpec {
  getDeviceInfo(): AllyNativeDeviceInfo;
  getPermissionStatus(key: AllyPermissionKey): boolean;
  openSettingsFor(key: AllyPermissionKey): boolean;
}

const AllyNative = requireOptionalNativeModule<AllyNativeSpec>('AllyNative');

export default AllyNative;
