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

/** One restricted app, named by the caller. Native never resolves labels — see FocusGuard.kt. */
export interface RestrictedApp {
  package: string;
  label: string;
}

/**
 * Raw Focus Guard state from the native side.
 *
 * WHY THERE ARE FIVE BOOLEANS AND NOT ONE. Each answers a different question the UI has to be able
 * to ask, and collapsing them would hide the state the user can actually act on:
 *
 *   hasAccess        the user granted accessibility access to Ally's service
 *   serviceConnected the system has actually bound and connected it
 *   available        both of the above — the feature can work at all
 *   active           the flag as last written, ignoring expiry: what was asked for
 *   guarding         the decision, expiry applied: what is happening right now
 *
 * `hasAccess && !serviceConnected` is a real, reachable state (just after the toggle is flipped,
 * or after Android stops the service while leaving the grant in place) and its fix differs from
 * "you have not granted anything yet".
 */
export interface FocusGuardNativeStatus {
  hasAccess: boolean;
  serviceConnected: boolean;
  available: boolean;
  active: boolean;
  guarding: boolean;
  /** Epoch millis the guard self-expires at; 0 for open-ended. */
  expiresAt: number;
  packages: RestrictedApp[];
  /** How many redirects this activation has performed. Reset on every activate. */
  redirects: number;
  lastPackage: string | null;
  lastLabel: string | null;
  lastAt: number | null;
}

export interface AllyNativeSpec {
  getDeviceInfo(): AllyNativeDeviceInfo;
  getPermissionStatus(key: AllyPermissionKey): boolean;
  openSettingsFor(key: AllyPermissionKey): boolean;

  // DND (T3)
  dndIsAvailable(): boolean;
  dndGetMode(): string;
  dndApply(mode: string): NativeApplyResult;
  /**
   * The RESTORE counterpart to dndApply. Deactivates Ally's AutomaticZenRule and reports what
   * the device settled on; falls back to the apply ladder only if releasing was not enough
   * (ADR-123). `rung: "zen_rule_released"` means nothing of Ally's is left holding the filter.
   */
  dndRelease(mode: string): NativeApplyResult;
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
  /**
   * Puts the user's original NotificationManager.Policy back, from durable storage (ADR-120).
   *
   * `restored` false with reason `nothing_saved` means there was nothing to put back, which is
   * success. A `permission` or `mismatch` reason RETAINS the saved policy so the caller can
   * retry; only a confirmed restore clears it.
   */
  dndRestorePolicy(): {
    ok: boolean;
    restored: boolean;
    reason: string | null;
    saved?: string | null;
    after?: string | null;
  };
  dndHasSavedPolicy(): boolean;

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
  // Alarm (A5.1). AlarmClock intents, so the alarm lands in the STOCK Clock app — never
  // AlarmManager, whose alarms are invisible there (ADR-127).
  alarmIsAvailable(): boolean;
  /**
   * Sends a wake-up alarm to the Clock app.
   *
   * `ok` means a real Clock activity resolved AND accepted the intent — NOT that the alarm
   * exists, which Android exposes no way to check. `skipped` is the honest answer to being asked
   * for an identical alarm twice in one session, which the Sleep plan currently does.
   */
  alarmSet(
    hour: number,
    minute: number,
    weekdays: boolean,
    sessionId: string,
  ): {
    ok: boolean;
    reason: string | null;
    message: string;
    clockPackage: string | null;
    identity: string | null;
    skipped: boolean;
    rung: string;
  };
  /** Dismisses only the alarm carrying Ally's label; unrelated alarms cannot be addressed. */
  alarmDismiss(sessionId: string | null): {
    ok: boolean;
    reason: string | null;
    message: string;
    clockPackage: string | null;
    skipped: boolean;
  };
  /** Opens the Clock's alarm list. The human read-back, since there is no API one. */
  alarmShowAlarms(): boolean;
  alarmForgetSession(sessionId: string): boolean;
  alarmDebugState(): Record<string, unknown>;

  callLogHasPermission(): boolean;
  callLogAnalyse(): Record<string, unknown>;

  /**
   * SPIKE ONLY — does `ringer` actually work on this phone, or is `not_supported` still the honest
   * answer? Nothing in the action engine calls these; they are removed if the answer is no.
   */
  ringerIsAvailable(): boolean;
  ringerGetMode(): string;
  ringerHasPolicyAccess(): boolean;
  ringerSpike(dwellMs: number): Promise<Record<string, unknown>>;

  /** System contact picker. See ContactPicker.kt. */
  contactPickerIsAvailable(): boolean;
  contactPickerOpen(): Promise<Record<string, unknown>>;

  /**
   * Study Mode Focus Guard (A7). See FocusGuard.kt.
   *
   * A redirect, not a block: the service notices a restricted app has come to the front and
   * presses Home. Nothing here prevents a launch, and no caller may describe it as if it does.
   */
  focusGuardStatus(): FocusGuardNativeStatus;
  focusGuardActivate(entries: RestrictedApp[], expiresAt: number): FocusGuardNativeStatus;
  focusGuardDeactivate(): FocusGuardNativeStatus;
  /** Opens Android's accessibility list. No public deep link to one service's toggle exists. */
  focusGuardOpenSettings(): boolean;
}

const AllyNative = requireOptionalNativeModule<AllyNativeSpec>('AllyNative');

export default AllyNative;
