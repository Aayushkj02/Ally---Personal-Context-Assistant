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

/** Android's SCREEN_BRIGHTNESS range, so the mock loses the same rounding the real device does. */
const RAW_MAX = 255;
const toPercent = (raw: number): number => Math.round((raw * 100) / RAW_MAX);
const toRaw = (percent: number): number => Math.round((percent * RAW_MAX) / 100);

/**
 * Simulated device state. Starts at plausible "normal phone" values.
 *
 * `brightnessRaw` is the source of truth and `brightness` is derived from it, exactly as on the
 * phone. Modelling both is what lets the mock reproduce the ADR-116 failure: raw 187 reports as
 * 73%, and 73% converts back to 186. A mock that stored only the percent could never show that.
 */
interface MockState {
  /** The EFFECTIVE interruption filter — what the phone is actually doing right now. */
  dnd: DndMode;
  /**
   * What the filter falls back to when Ally's own rule stands down: the user's own schedules,
   * their manual Do Not Disturb, whatever else they have running.
   *
   * Modelled separately from `dnd` because ADR-123 is invisible without it. On the real device
   * Android combines every active rule, so "the filter reads priority" does not tell you WHOSE
   * rule is holding it there — and a restore that re-asserts Ally's rule looks identical to one
   * that released it. Splitting effective from underlying is what lets a test tell them apart.
   */
  userDnd: DndMode;
  /** Whether Ally's AutomaticZenRule is the thing currently holding the filter. */
  allyRuleActive: boolean;
  brightnessRaw: number;
  ringer: RingerMode;
  alarm: string | null;
  /** Flip these to exercise the permission-blocked UI without touching a real device. */
  permissions: Record<PermissionRequirement['key'], boolean>;
}

const DEFAULT_RAW = 187;

const state: MockState = {
  dnd: 'off',
  userDnd: 'off',
  allyRuleActive: false,
  brightnessRaw: DEFAULT_RAW,
  ringer: 'normal',
  alarm: null,
  permissions: {
    notification_policy: true,
    write_settings: true,
    microphone: true,
    exact_alarm: true,
  },
};

/**
 * Stands in for the SharedPreferences that BrightnessController writes (ADR-116).
 *
 * The distinction this models is the whole point of A-V2: `state` is the DEVICE and survives the
 * app dying; this is ALLY'S MEMORY and survives only because it is on disk. Anything the real
 * controller keeps in the heap would be gone after __simulateProcessDeath(), so a test that
 * restores exactly across that call is proving the memory is genuinely durable.
 */
const prefs = new Map<string, number>();

/**
 * The five ints of a NotificationManager.Policy (ADR-120).
 *
 * Modelled in full, not just the three Ally writes, because Ally's 3-argument write replaces
 * `suppressedVisualEffects` and `priorityConversationSenders` with constructor defaults — so a
 * restore that only puts three back hands the user a policy they never had. The mock carries all
 * five for the same reason the device does.
 */
export interface MockPolicy {
  priorityCategories: number;
  priorityCallSenders: number;
  priorityMessageSenders: number;
  suppressedVisualEffects: number;
  priorityConversationSenders: number;
}

/** A plausible "user's own settings" starting point: alarms + media, starred senders. */
const DEFAULT_POLICY: MockPolicy = {
  priorityCategories: 0b100010,
  priorityCallSenders: 2,
  priorityMessageSenders: 2,
  suppressedVisualEffects: 511,
  priorityConversationSenders: 1,
};

/** The device's live policy. Survives process death, because the phone owns it. */
let livePolicy: MockPolicy = { ...DEFAULT_POLICY };

/**
 * Ally's saved copy — SharedPreferences, so it survives process death too. That distinction is
 * the whole of ADR-120: the heap does not survive, and a policy saved only in the heap is a
 * policy the user never gets back.
 */
let savedPolicy: MockPolicy | null = null;

const rawKey = (percent: number): string => `raw_${percent}`;
/** Mirrors BrightnessController's KEY_BORROWED: set on capture, cleared when it goes back. */
const BORROWED = 'borrowed';

/**
 * FIRST WRITE WINS WHILE A BORROW IS OPEN (ADR-124), last write wins otherwise — the same rule
 * BrightnessController.kt follows, and modelled here because the bug it prevents is reachable
 * without a phone: a blocked restore reads the current percent to fill in `beforeValue`, and if
 * that percent equals the snapshotted one (raw 186 and 187 both report 73%) an unconditional
 * write replaces the user's value with Ally's.
 */
function rememberRaw(percent: number, raw: number): void {
  const key = rawKey(percent);
  if (prefs.has(BORROWED) && prefs.has(key)) return;
  prefs.set(key, raw);
}

function recallRaw(percent: number): number | null {
  return prefs.get(rawKey(percent)) ?? null;
}

/** Test hook: force a permission off to preview the blocked state in the UI. */
export function __setMockPermission(key: PermissionRequirement['key'], granted: boolean): void {
  state.permissions[key] = granted;
}

/** Test hook: read the simulated device state in unit tests. */
export function __getMockState(): Readonly<MockState> {
  return state;
}

export function __resetMockState(): void {
  livePolicy = { ...DEFAULT_POLICY };
  savedPolicy = null;
  state.dnd = 'off';
  state.userDnd = 'off';
  state.allyRuleActive = false;
  state.brightnessRaw = DEFAULT_RAW;
  state.ringer = 'normal';
  state.alarm = null;
  state.permissions = {
    notification_policy: true,
    write_settings: true,
    microphone: true,
    exact_alarm: true,
  };
  prefs.clear();
}

/** Test hook: the device's true raw brightness, which the percent contract cannot express. */
export function __getMockBrightnessRaw(): number {
  return state.brightnessRaw;
}

/** Test hook: what the percent contract would report for the device's current raw value. */
export function __getMockBrightnessPercent(): number {
  return toPercent(state.brightnessRaw);
}

/** Test hook: place the device at a specific raw value, as a real phone would already be. */
export function __setMockBrightnessRaw(raw: number): void {
  state.brightnessRaw = raw;
}

/**
 * Test hook: the user already had Do Not Disturb on, by their own rule, before Ally arrived.
 *
 * Sets both the underlying mode and the effective one, because that is the honest starting
 * position — nothing of Ally's is active yet, so the two are the same thing.
 */
export function __setMockUserDnd(mode: DndMode): void {
  state.userDnd = mode;
  if (!state.allyRuleActive) state.dnd = mode;
}

/** Test hook: is Ally's own zen rule the thing holding the filter? (ADR-123) */
export function __getMockAllyRuleActive(): boolean {
  return state.allyRuleActive;
}

/**
 * Test hook: the app process dies and comes back.
 *
 * Wipes everything a real restart would wipe — module-level heap caches — while leaving BOTH
 * `state` (the device's own settings, which Android keeps) and `prefs` (on disk) untouched.
 * There is deliberately no heap cache of snapshot data to clear here, and that is the invariant
 * this hook exists to guard: if snapshot memory ever moves back into the heap, the restore-
 * after-process-death test starts failing instead of silently returning a value one raw unit off.
 */
export function __simulateProcessDeath(): void {
  // `savedPolicy` and `livePolicy` deliberately survive: the first stands in for
  // SharedPreferences, the second for the phone's own setting. Neither is heap state a real
  // restart would lose, and a test that restores exactly across this call is proving it.
}

/** Test hook: the device's live notification policy, all five fields. */
export function __getMockPolicy(): MockPolicy {
  return { ...livePolicy };
}

/** Test hook: put the device in a specific policy state, as a real phone would already be. */
export function __setMockPolicy(policy: MockPolicy): void {
  livePolicy = { ...policy };
}

/** Test hook: what Ally has saved to put back, or null. */
export function __getMockSavedPolicy(): MockPolicy | null {
  return savedPolicy ? { ...savedPolicy } : null;
}

/**
 * Applies Ally's priority policy, mirroring DndController.setPriority().
 *
 * FIRST WRITE WINS on the save, and the write goes through the 3-field shape Android's
 * 3-argument constructor produces — which is exactly why the other two fields need restoring.
 */
export function __applyMockPriorityPolicy(calls: boolean, messages: boolean): void {
  if (!savedPolicy) savedPolicy = { ...livePolicy };

  let categories = 0b100000; // ALARMS always
  if (calls) categories |= 0b1;
  if (messages) categories |= 0b100;

  livePolicy = {
    priorityCategories: categories,
    priorityCallSenders: calls ? 2 : 0,
    priorityMessageSenders: messages ? 2 : 0,
    // The 3-argument constructor's defaults — the user's values are gone until restore.
    suppressedVisualEffects: 0,
    priorityConversationSenders: 0,
  };
}

/**
 * Puts the saved policy back, mirroring DndController.restoreSavedPolicy().
 *
 * Driven by whether a policy was saved, never by the DND mode. Cleared only on a confirmed
 * restore, so a failure stays retryable with the original intact.
 */
export function __restoreMockPolicy(): { ok: boolean; restored: boolean; reason: string | null } {
  if (!savedPolicy) return { ok: true, restored: false, reason: 'nothing_saved' };

  if (!state.permissions.notification_policy) {
    return { ok: false, restored: false, reason: 'permission' };
  }

  livePolicy = { ...savedPolicy };
  savedPolicy = null;
  return { ok: true, restored: true, reason: null };
}

function permission(key: PermissionRequirement['key']): PermissionRequirement {
  return { ...PERMISSION_LABELS[key], granted: state.permissions[key] };
}

/**
 * PARITY (ADR-007): the native backend reports the CURRENT value on both sides of a blocked
 * call, so the UI can render "priority -> priority" as visible proof nothing moved. The mock
 * must do the same or the two backends disagree on the shape of a denial.
 */
function blocked(
  capability: Capability,
  key: PermissionRequirement['key'],
  current: CapabilityValue | null,
): ActionResult {
  return {
    capability,
    status: 'permission_needed',
    beforeValue: current,
    afterValue: current,
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
      if (!state.permissions[permissionKey]) {
        return blocked(capability, permissionKey, state[field] as CapabilityValue | null);
      }

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
      if (!state.permissions[permissionKey]) {
        return blocked(capability, permissionKey, state[field] as CapabilityValue | null);
      }

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

const dndMode = makeCapability('dnd', 'dnd', 'notification_policy', (v) =>
  v === 'off' ? 'Interruptions back to normal.' : `Interruptions set to ${v}.`,
);

/** The effective filter is Ally's rule when it is holding, the user's own state otherwise. */
function settleDnd(): void {
  if (!state.allyRuleActive) state.dnd = state.userDnd;
}

/**
 * DND restores BOTH borrowed things, matching DndCapability on the real backend (ADR-007
 * parity): the notification policy first, then the interruption filter on top of it.
 *
 * The policy goes back regardless of which mode is being returned to — that unconditional-ness
 * is the ADR-120 fix, and a mock that restored it only on `off` would let the bug back in
 * untested.
 *
 * The FILTER goes back by RELEASING Ally's rule, not by re-applying the snapshotted mode
 * (ADR-123). Modelled here so the failure is reachable in Node: for a user who already had Do
 * Not Disturb on, re-applying "priority" reads back as a perfect restore while leaving Ally's
 * own rule the thing holding their phone silent, forever, with the snapshots cleared. Standing
 * down first and only re-asserting if the device did not land there by itself is the difference,
 * and `allyRuleActive` is how a test can see it.
 */
const dnd: DeviceCapability = {
  ...dndMode,

  async execute(value) {
    if (!state.permissions.notification_policy) {
      return blocked('dnd', 'notification_policy', state.dnd);
    }
    const before = state.dnd;
    state.allyRuleActive = value !== 'off';
    state.dnd = state.allyRuleActive ? (value as DndMode) : state.userDnd;

    if (state.dnd !== value) {
      return {
        capability: 'dnd',
        status: 'failed',
        beforeValue: before,
        afterValue: state.dnd,
        message: 'The setting did not take effect.',
      };
    }
    return {
      capability: 'dnd',
      status: 'applied',
      beforeValue: before,
      afterValue: state.dnd,
      message: value === 'off' ? 'Interruptions back to normal.' : `Interruptions set to ${value}.`,
    };
  },

  async restore(previous) {
    if (!state.permissions.notification_policy) {
      return blocked('dnd', 'notification_policy', state.dnd);
    }
    __restoreMockPolicy();

    const before = state.dnd;

    // Stand down first, then look.
    state.allyRuleActive = false;
    settleDnd();

    const released = state.dnd === previous;
    if (!released) {
      // Releasing was not enough to reach what the user had. Re-assert, and say which it was.
      state.allyRuleActive = previous !== 'off';
      state.dnd = previous as DndMode;
    }

    return {
      capability: 'dnd',
      status: 'restored',
      beforeValue: before,
      afterValue: state.dnd,
      message: `Interruptions back to ${previous}. [${released ? 'zen_rule_released' : 'zen_rule'}]`,
    };
  },
};

/**
 * The mock's borrowed-policy port (ADR-125), matching `createBorrowedPolicy()` on the real
 * backend. Same two questions, same durable store — here that store is `savedPolicy`, which
 * survives __simulateProcessDeath() for exactly the reason SharedPreferences does.
 */
export const mockBorrowedPolicy = {
  hasSaved: () => savedPolicy !== null,
  restore: () => __restoreMockPolicy(),
};

/**
 * Brightness cannot use makeCapability: the contract currency is a PERCENT but the device stores
 * a RAW value, and the whole of ADR-116 lives in the gap between them. This mirrors
 * BrightnessController.kt step for step so the semantics can be tested without a phone.
 */
const brightness: DeviceCapability = {
  async isAvailable() {
    return true;
  },

  async requiredPermissions() {
    return [permission('write_settings')];
  },

  /** Reading needs no permission. Returns the percent AND remembers the exact raw value. */
  async snapshot() {
    const percent = toPercent(state.brightnessRaw);
    // Remember first, then open the borrow: a fresh capture may overwrite a stale value from an
    // older session, every reading after it may not.
    rememberRaw(percent, state.brightnessRaw);
    prefs.set(BORROWED, 1);
    return percent;
  },

  async execute(value) {
    if (!state.permissions.write_settings) {
      return blocked('brightness', 'write_settings', toPercent(state.brightnessRaw));
    }

    const before = toPercent(state.brightnessRaw);
    state.brightnessRaw = toRaw(Number(value));
    const after = toPercent(state.brightnessRaw);

    if (after !== Number(value)) {
      return {
        capability: 'brightness',
        status: 'failed',
        beforeValue: before,
        afterValue: after,
        message: 'The setting did not take effect.',
      };
    }

    return {
      capability: 'brightness',
      status: 'applied',
      beforeValue: before,
      afterValue: after,
      message: `Brightness set to ${after}%.`,
    };
  },

  /**
   * Writes back the EXACT raw value captured at snapshot time. Falling back to toRaw() is a
   * genuine last resort — it is the path that returns 186 where the user had 187.
   */
  async restore(previous) {
    if (!state.permissions.write_settings) {
      return blocked('brightness', 'write_settings', toPercent(state.brightnessRaw));
    }

    const percent = Number(previous);
    const before = toPercent(state.brightnessRaw);
    state.brightnessRaw = recallRaw(percent) ?? toRaw(percent);
    // The value is back, so the borrow is closed and fresh readings count again.
    prefs.delete(BORROWED);

    return {
      capability: 'brightness',
      status: 'restored',
      beforeValue: before,
      afterValue: toPercent(state.brightnessRaw),
      message: `Brightness set to ${percent}%.`,
    };
  },
};

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
    if (!state.permissions.exact_alarm) return blocked('alarm', 'exact_alarm', null);
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
