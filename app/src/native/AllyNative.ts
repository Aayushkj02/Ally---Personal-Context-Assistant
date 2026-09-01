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
import type { BorrowedPolicy } from '../actions/executors';
import AllyNative, { type AllyNativeDeviceInfo } from '../../modules/ally-native';
import { createNativeCapabilities } from './capabilities';
import {
  createAlarmCapability,
  dismissAlarm,
  type AlarmContext,
} from './capabilities/AlarmCapability';

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
 * The same registry, with the alarm capability bound to THIS context's recurrence and session
 * (ADR-127).
 *
 * The ActionPlan cannot carry either: `PlannedAction.value` is a string, so a one-shot and a
 * weekday alarm arrive identical, and nothing in it scopes idempotency. Both facts are already in
 * the app shell's hands — `intent.schedule.kind` and `plan.sessionId` — so the shell composes the
 * device and passes it to `startContext`, which is the rule the executor already lives by: it is
 * handed a device, it never reaches for one (ADR-115).
 *
 * Everything except `alarm` is delegated to the base registry unchanged, so this cannot become a
 * second device model — there is one registry, with one entry swapped.
 */
export function withAlarmContext(base: DeviceRegistry, context: AlarmContext): DeviceRegistry {
  if (!AllyNative) return base;

  const alarm = createAlarmCapability(AllyNative, context);
  return {
    backend: base.backend,
    get(capability) {
      return capability === 'alarm' ? alarm : base.get(capability);
    },
    openSettingsFor: base.openSettingsFor,
  };
}

/**
 * Asks the Clock to dismiss Ally's own alarm (A5.5). Null on the mock backend.
 *
 * Standalone rather than a capability method, because cancelling is neither an `execute` nor a
 * `restore`, and because no ActionPlan can currently express it — see AlarmCapability.
 */
export function dismissAllyAlarm(sessionId: string | null = null) {
  return AllyNative ? dismissAlarm(AllyNative, sessionId) : null;
}

/** Opens the Clock's own alarm list. The human read-back, since Android offers no API one. */
export function showClockAlarms(): boolean {
  return AllyNative ? AllyNative.alarmShowAlarms() : false;
}

/** Diagnostics: which Clock handles our intents, and what Ally currently remembers sending. */
export function alarmDebugState(): Record<string, unknown> | null {
  return AllyNative ? AllyNative.alarmDebugState() : null;
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
 * SPIKE ONLY — runs the ringer feasibility matrix on the real phone and returns the report.
 *
 * `ringer` has answered `not_supported` since Phase 2. This exists to find out whether that is
 * still the honest answer or whether it has simply never been tried on hardware. It changes the
 * user's actual ringer mode for the duration and restores it in a `finally`. Nothing in the action
 * engine calls it, and it is removed if the answer turns out to be no.
 */
export async function allyNativeSpike(): Promise<Record<string, unknown>> {
  if (!AllyNative) return { error: 'mock backend — no phone to spike' };
  return {
    available: AllyNative.ringerIsAvailable(),
    policyAccess: AllyNative.ringerHasPolicyAccess(),
    modeBefore: AllyNative.ringerGetMode(),
    ...(await AllyNative.ringerSpike(3000)),
  };
}

/**
 * What the system contact picker handed back.
 *
 * `starred` is REPORTED, NEVER STORED. Ally's DND enforcement is scoped to starred contacts and
 * nothing finer (ADR-111), so an unstarred priority contact is silenced anyway. Starring is
 * changed in Contacts at any moment, so a persisted copy would go stale and start lying — Ally
 * asks the phone each time it needs the answer.
 */
export interface PickedContact {
  ok: boolean;
  displayName?: string;
  starred?: boolean;
  /** 'cancelled' | 'unreadable' | 'no_name' | 'security' | 'error' | 'not_ready' | 'unavailable' */
  reason?: string;
}

/** True when this phone has something that answers the pick intent (needs the `<queries>` entry). */
export function contactPickerAvailable(): boolean {
  return AllyNative ? AllyNative.contactPickerIsAvailable() : false;
}

/**
 * Opens the system contact picker and resolves with what the user chose.
 *
 * ALWAYS RESOLVES, NEVER REJECTS. Cancelling is an ordinary thing to do and comes back as
 * `{ ok: false, reason: 'cancelled' }` so a caller can quietly do nothing. A rejection here would
 * surface to the user as a failure for something they did on purpose.
 *
 * Requests no contacts permission: the picker runs in the system's own process and the result
 * carries a one-time read grant for the single chosen contact.
 */
export async function pickContact(): Promise<PickedContact> {
  if (!AllyNative) return { ok: false, reason: 'unavailable' };
  try {
    const raw = await AllyNative.contactPickerOpen();
    // Checked rather than cast. This value crosses the bridge from Kotlin, and a screen is about
    // to write it to the database as a contact the user will see — a shape assumption here would
    // be exactly the sort of unverified claim the rest of this layer refuses to make.
    if (raw.ok !== true) {
      return { ok: false, reason: typeof raw.reason === 'string' ? raw.reason : 'error' };
    }
    const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
    if (displayName === '') return { ok: false, reason: 'no_name' };
    return { ok: true, displayName, starred: raw.starred === true };
  } catch {
    // The bridge is the only thing that can throw here, and a dead bridge is not the user's doing.
    return { ok: false, reason: 'error' };
  }
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

/**
 * The user's own NotificationManager.Policy, as a port the restore walk can reach (ADR-125).
 *
 * Null on the mock backend, exactly like `createNativeRegistry()` — src/native/index.ts picks
 * the matching mock so the layers above never learn which one they got.
 *
 * The durability, the first-write-wins capture and the retain-on-failure rule all live in
 * DndController; nothing here re-decides any of it. This is a two-method window onto that store,
 * and it exists because priority mutates the policy from outside the ActionPlan, so restore
 * needs a way to give it back that does not depend on a `dnd` snapshot row existing.
 */
export function createBorrowedPolicy(): BorrowedPolicy | null {
  if (!AllyNative) return null;

  const native = AllyNative;
  return {
    hasSaved: () => native.dndHasSavedPolicy(),
    restore: () => {
      const raw = native.dndRestorePolicy();
      return {
        ok: raw.ok === true,
        restored: raw.restored === true,
        reason: raw.reason ?? null,
      };
    },
  };
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
