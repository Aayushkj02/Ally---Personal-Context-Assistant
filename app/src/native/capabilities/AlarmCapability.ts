/**
 * OWNER: AAYUSH — task A5.1
 *
 * Real alarm capability, backed by AlarmController.kt (android.provider.AlarmClock — ADR-127).
 *
 * WHAT `applied` MEANS HERE, AND ONLY HERE. Everywhere else in this codebase it means "we wrote
 * the value and then read it back" (PRD §20, NFR-03). Android exposes no way to read the Clock
 * app's alarms — SET, DISMISS and SHOW exist; there is no provider and no `getAlarms()` — so that
 * verification is impossible for this one capability. Rather than fake it, `applied` is defined
 * down to exactly what IS checked:
 *
 *   1. a real Clock activity resolves for the intent, and
 *   2. `startActivity` accepted it without throwing.
 *
 * The message says "Sent to your Clock app", never "your alarm is set". Whether the alarm truly
 * exists, at the right time, with the right recurrence, is proved by opening the stock Clock
 * during device testing — that observation is the acceptance evidence (docs/DEVICE_NOTES.md).
 *
 * AN ALARM IS NOT BORROWED STATE. `snapshot()` returns null and `restore()` reports `skipped`:
 * a wake-up alarm the user asked for is not collateral of the context, and deleting it when Sleep
 * ends would be the app quietly cancelling the thing the user actually wanted. This preserves the
 * behaviour MockDevice has had since T6 — restoration puts back what Ally took, and Ally did not
 * take the alarm.
 */

import type { ActionResult, CapabilityValue, DeviceCapability } from '../../types';
import type { AllyNativeSpec } from '../../../modules/ally-native';
import { describePermission } from '../permissions';

/** "HH:MM", 24-hour. The frozen CapabilityValue for `alarm`. */
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export interface AlarmTime {
  hour: number;
  minute: number;
}

/** Parses the contract's time string. Null for anything that is not one. */
export function parseAlarmTime(value: CapabilityValue): AlarmTime | null {
  const match = TIME.exec(String(value));
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * The two things the ActionPlan cannot carry, supplied at the integration boundary (ADR-127).
 *
 * WHY THIS IS NOT IN THE PLAN. `PlannedAction.value` is `CapabilityValue = string | number` and
 * `src/types/` is frozen, so an alarm action can hold "07:00" and nothing else — a one-shot and a
 * weekday plan are byte-identical by the time they reach here. The recurrence the user actually
 * said survives in `intent.schedule.kind`, which the app shell already holds, so the shell binds
 * it to the capability and hands the registry in. That is the same rule the executor already
 * follows for the device itself: it is handed one, it never reaches for one (ADR-115).
 *
 * NOTHING IS INFERRED FROM ABSENCE. No context, or `recurrence: 'once'`, means a one-shot alarm
 * and `EXTRA_DAYS` is never sent — an omitted recurrence cannot become a daily alarm by accident.
 */
export interface AlarmContext {
  /** Verbatim from `intent.schedule.kind`. Never derived here. */
  recurrence: 'once' | 'weekdays';
  /**
   * Idempotency scope. The Sleep plan currently contains the same alarm action TWICE — once
   * resolved from the command and once appended from the schedule — so without a scope every
   * sleep request would put two identical alarms in the user's Clock.
   */
  sessionId: string;
}

function fail(status: ActionResult['status'], message: string): ActionResult {
  return { capability: 'alarm', status, beforeValue: null, afterValue: null, message };
}

export function createAlarmCapability(
  native: AllyNativeSpec,
  context?: AlarmContext,
): DeviceCapability {
  const weekdays = context?.recurrence === 'weekdays';
  // A capability with no context still works and is still safe: one-shot, and idempotent within
  // whatever the caller calls a session. It is what the default registry hands out.
  const sessionId = context?.sessionId ?? 'ally_default';

  return {
    async isAvailable() {
      try {
        return native.alarmIsAvailable();
      } catch {
        return false;
      }
    },

    async requiredPermissions() {
      return [describePermission('exact_alarm', native.getPermissionStatus('exact_alarm'))];
    },

    /** Nothing to capture. Android will not tell us what alarms exist, and none of them are ours. */
    async snapshot() {
      return null;
    },

    async execute(value) {
      const time = parseAlarmTime(value);
      if (!time) {
        return fail('failed', `"${String(value)}" is not a time of day.`);
      }

      let res;
      try {
        res = native.alarmSet(time.hour, time.minute, weekdays, sessionId);
      } catch (e) {
        return fail('failed', e instanceof Error ? e.message : 'Setting the alarm failed.');
      }

      // Asked for the identical alarm twice in one session. Honest, and not a failure — the
      // Clock already has it, and sending again would add a second copy.
      if (res.skipped) {
        return {
          capability: 'alarm',
          status: 'skipped',
          beforeValue: null,
          afterValue: value,
          message: res.message,
        };
      }

      if (res.ok) {
        return {
          capability: 'alarm',
          status: 'applied',
          beforeValue: null,
          afterValue: value,
          // Carries which Clock app took it, so "the Clock refused" and "there is no Clock" are
          // distinguishable after the fact.
          message: `${res.message} [${res.clockPackage ?? res.rung}]`,
        };
      }

      const status: ActionResult['status'] =
        res.reason === 'permission'
          ? 'permission_needed'
          : res.reason === 'unsupported'
            ? 'not_supported'
            : 'failed';

      return fail(status, res.message);
    },

    /**
     * Ending a context does NOT cancel the wake-up alarm.
     *
     * `skipped`, with a sentence that says so, because the alternative is worse in a way that is
     * easy to miss: Sleep ends when the user wakes up, and deleting their 7am alarm at that
     * moment would remove tomorrow's alarm too. Restoration puts back what Ally borrowed, and an
     * alarm the user asked for was never borrowed. Cancelling one is a separate request with its
     * own path (A5.5).
     */
    async restore() {
      return {
        capability: 'alarm',
        status: 'skipped',
        beforeValue: null,
        afterValue: null,
        message: 'Your alarm stays in the Clock app. Ending a context does not cancel it.',
      };
    },
  };
}

export interface AlarmDismissOutcome {
  ok: boolean;
  reason: string | null;
  message: string;
}

/**
 * Asks the Clock to dismiss the alarm Ally created (A5.5).
 *
 * NOT a DeviceCapability method, because it is not one: the frozen `DeviceCapability` has
 * `execute` and `restore`, and cancelling is neither. It is also not reachable from an
 * `ActionPlan` today — "Cancel the wake-up alarm" resolves to an intent whose plan contains no
 * alarm action at all — so this is deliberately a standalone function the upstream path can be
 * wired to later, rather than a cancellation action invented inside this layer.
 *
 * Scoped to Ally's own label, which is the only targeting Android offers and is also the safety
 * property: there is no argument here that could name the user's own alarms.
 */
export function dismissAlarm(
  native: AllyNativeSpec,
  sessionId: string | null = null,
): AlarmDismissOutcome {
  try {
    const res = native.alarmDismiss(sessionId);
    return { ok: res.ok === true, reason: res.reason ?? null, message: res.message };
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      message: e instanceof Error ? e.message : 'Your Clock app would not dismiss the alarm.',
    };
  }
}
