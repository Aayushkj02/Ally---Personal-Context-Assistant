/**
 * OWNER: AAYUSH
 *
 * Permission metadata shared by BOTH the mock and the real native backend.
 *
 * It lives here rather than inside either backend so the two cannot drift — the
 * parity obligation in ADR-007 is easier to keep when there is only one copy.
 * Copy states what the user sees; keep it plain language, never API jargon.
 */

import type { PermissionRequirement } from '../types';

export const PERMISSION_LABELS: Record<
  PermissionRequirement['key'],
  Omit<PermissionRequirement, 'granted'>
> = {
  notification_policy: {
    key: 'notification_policy',
    label: 'Do Not Disturb access',
    rationale: 'Lets Ally quiet notifications while a context is active.',
  },
  write_settings: {
    key: 'write_settings',
    label: 'Modify system settings',
    rationale: 'Lets Ally change screen brightness and put it back afterwards.',
  },
  microphone: {
    key: 'microphone',
    label: 'Microphone',
    rationale: 'Lets you tell Ally what you are doing instead of typing it.',
  },
  /**
   * KEY IS FROZEN, MEANING IS NOT. `exact_alarm` is the name in the frozen permission union, but
   * what it now reports is `com.android.alarm.permission.SET_ALARM` — the permission
   * ACTION_SET_ALARM actually needs (ADR-127). It used to report SCHEDULE_EXACT_ALARM, which
   * belongs to AlarmManager, an API Ally deliberately does not use because its alarms never reach
   * the Clock app. The label no longer names Android's "Alarms & reminders" screen, because
   * sending the user there would have toggled something with no effect on this capability.
   */
  exact_alarm: {
    key: 'exact_alarm',
    label: 'Set alarms in your Clock app',
    rationale: "Lets Ally put the wake-up alarm you asked for into your phone's own Clock.",
  },
};

export function describePermission(
  key: PermissionRequirement['key'],
  granted: boolean,
): PermissionRequirement {
  return { ...PERMISSION_LABELS[key], granted };
}

/** The standard blocked result. No mutation is attempted when this is returned. */
export function permissionBlocked(
  capability: string,
  key: PermissionRequirement['key'],
): { status: 'permission_needed'; message: string } {
  void capability;
  return {
    status: 'permission_needed',
    message: `${PERMISSION_LABELS[key].label} is needed before Ally can change this.`,
  };
}
