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

/** Result of a native mutation. `ok` is only true after the native side read the value back. */
export interface NativeApplyResult {
  ok: boolean;
  /** Why it failed: 'permission' | 'unsupported' | 'mismatch' | 'error'. Null when ok. */
  reason: string | null;
  before: string | null;
  after: string | null;
  message: string;
  /** Which ADR-102 rung did the work: 'zen_rule' | 'interruption_filter' | 'none'. */
  rung: string;
}

export interface AllyNativeSpec {
  getDeviceInfo(): AllyNativeDeviceInfo;
  getPermissionStatus(key: AllyPermissionKey): boolean;
  openSettingsFor(key: AllyPermissionKey): boolean;

  // DND (T3)
  dndIsAvailable(): boolean;
  dndGetMode(): string;
  dndApply(mode: string): NativeApplyResult;
  dndDebugState(): Record<string, unknown>;
  /** Demo-device compatibility probe. Reverts everything it touches. */
  dndProbe(): Record<string, unknown>;

  /** Priority-caller exception + Android's repeat-caller bypass (ADR-107). */
  dndSetPriorityCallers(
    allowStarred: boolean,
    allowRepeatCallers: boolean,
  ): Record<string, unknown>;
  /**
   * Applies priority preferences for the channels Android ENFORCES: calls and SMS.
   * WhatsApp is absent by design — no public API can enforce it (ADR-111).
   */
  dndSetPriority(
    allowStarred: boolean,
    allowRepeatCallers: boolean,
    allowMessages: boolean,
  ): Record<string, unknown>;
  dndPolicySnapshot(): Record<string, unknown>;

  // Brightness (T4). Percent is the contract currency; raw values prove exact restoration.
  brightnessIsAvailable(): boolean;
  brightnessSnapshot(): {
    ok: boolean;
    reason: string | null;
    percent: number | null;
    raw: number | null;
    autoMode?: boolean;
  };
  brightnessApply(
    percent: number,
  ): NativeApplyResult & { beforeRaw: number | null; afterRaw: number | null };
  /**
   * `exact` is the A-V2 proof (ADR-116): true when the raw value captured at snapshot time was
   * still on disk and written back verbatim, false when it had to be reconstructed from the
   * percent and may be a raw unit off. It reports what the store held, never what the result
   * looked like.
   */
  brightnessRestore(percent: number): NativeApplyResult & {
    beforeRaw: number | null;
    afterRaw: number | null;
    exact: boolean;
    restoredRaw: number;
  };

  // Repeated-caller DETECTION only. Never changes DND, never makes anything ring (ADR-109).
  callLogHasPermission(): boolean;
  callLogAnalyse(): Record<string, unknown>;
}

const AllyNative = requireOptionalNativeModule<AllyNativeSpec>('AllyNative');

export default AllyNative;
