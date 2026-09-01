/**
 * OWNER: AAYUSH — task A7.
 *
 * The Focus Guard seam: the restricted-app list, the four native calls, and the pure function that
 * decides what the UI is allowed to say about any of it.
 *
 * WHAT FOCUS GUARD IS. When a study session is running and the user opens an app on the restricted
 * list, an AccessibilityService notices the app has reached the front and presses Home. It is a
 * REDIRECT, not a block.
 *
 * WHY IT CANNOT BE A BLOCK, SO NOBODY HAS TO RE-DERIVE THIS. Real package suspension is
 * `DevicePolicyManager.setPackagesSuspended`, gated on `android.permission.SUSPEND_APPS`. Measured
 * on SM-S928B / API 36, that permission's protection level is `signature|verifier|role`, and the
 * call additionally needs device-owner or profile-owner on user 0 — the phone has neither, and
 * acquiring device-owner needs provisioning before setup completes, i.e. a factory reset. Samsung's
 * own App Timer does this from `/system/priv-app/DigitalWellbeing` with the PRIVILEGED flag. Ally
 * is an ordinary `/data/app` install and always will be, so the honest ceiling for this feature is
 * "notice and redirect". See docs/DEVICE_NOTES.md for the full probe output.
 *
 * THE ONE RULE FOR EVERY STRING THAT DESCRIBES THIS FEATURE: Ally restricted the app, not Android.
 * "Android blocked this app" would be a lie, and it is the specific lie this file exists to
 * prevent — the same rule that keeps `ringer` reporting `not_supported` instead of pretending.
 */

import AllyNative, {
  type FocusGuardNativeStatus,
  type RestrictedApp,
} from '../../modules/ally-native';

export type { FocusGuardNativeStatus, RestrictedApp };

/**
 * The prototype's restricted list (A7.9).
 *
 * Here rather than in Kotlin because which apps count as distracting is a product decision, and a
 * native default would be a second source of truth for it. Not the user's data: two well-known
 * package names, chosen for the demo because both are installed on the demo phone. A real version
 * would let the user pick, which is why the native side takes the list as an argument and stores
 * whatever it is handed.
 */
export const DEMO_RESTRICTED_APPS: readonly RestrictedApp[] = [
  { package: 'com.instagram.android', label: 'Instagram' },
  { package: 'com.supercell.clashroyale', label: 'Clash Royale' },
];

/** Null on the mock backend — there is no phone to guard. */
export function focusGuardStatus(): FocusGuardNativeStatus | null {
  return AllyNative ? AllyNative.focusGuardStatus() : null;
}

/**
 * Turns the guard on for a session.
 *
 * `endsAt` is the session's own end time, passed straight through so the native side can expire
 * itself without Ally being alive to tell it to (A7.7). Null means open-ended.
 */
export function activateFocusGuard(
  endsAt: number | null,
  apps: readonly RestrictedApp[] = DEMO_RESTRICTED_APPS,
): FocusGuardNativeStatus | null {
  if (!AllyNative) return null;
  return AllyNative.focusGuardActivate([...apps], endsAt ?? 0);
}

export function deactivateFocusGuard(): FocusGuardNativeStatus | null {
  return AllyNative ? AllyNative.focusGuardDeactivate() : null;
}

/** Opens Android's accessibility list. See FocusGuard.kt: there is no deep link to one toggle. */
export function openFocusGuardSettings(): boolean {
  return AllyNative ? AllyNative.focusGuardOpenSettings() : false;
}

/**
 * Brings the guard in line with whatever session is actually running (A7.7 / A7.8).
 *
 * THE RECONCILER, AND THE ONLY THING ALLOWED TO TURN THE GUARD ON OR OFF. Called from the shell's
 * context refresh, which reads the DATABASE rather than React state, so this is driven by the same
 * source of truth as the rest of the screen. That is what makes the awkward cases fall out for
 * free rather than needing their own handling:
 *
 *   - study session running        -> guard on, expiring with the session
 *   - session ended                -> guard off
 *   - sleep session, or none       -> guard off
 *   - Ally killed and reopened     -> refresh runs, the DB still says study, guard stays on
 *   - Ally killed and NEVER reopened -> the native expiry switches it off at the session's end
 *
 * WHAT RECONCILING CANNOT FIX, measured on the S24 Ultra: the guard's STATE survives a process
 * death (it lives in native prefs) but the accessibility BINDING does not. Android took ~5-10s to
 * restart the killed process, and restricted apps opened normally until it did. Re-arming the
 * state on the next refresh is correct, and is not the same as the guard having been up throughout.
 *
 * Returns the fresh status so the caller has one call to make, not two.
 */
export function syncFocusGuard(session: {
  isStudy: boolean;
  endsAt: number | null;
}): FocusGuardNativeStatus | null {
  if (!AllyNative) return null;
  return session.isStudy ? activateFocusGuard(session.endsAt) : deactivateFocusGuard();
}

/** What the UI should show. `tone` maps to the theme's semantic colours, never to a raw hex. */
export interface FocusGuardPresentation {
  tone: 'success' | 'warning' | 'neutral';
  headline: string;
  detail: string;
  /** Set when there is something the user can do about it. Null when there is not. */
  actionLabel: string | null;
  /** True only while the guard is genuinely restricting apps right now. */
  guarding: boolean;
}

/**
 * The honest sentence for every reachable state (A7.10).
 *
 * PURE, AND TESTED, because this is where the feature would most easily start lying. Two states in
 * particular have to stay distinct, and a single `available` boolean would have merged them:
 * "you have not granted access" (the user must go to Settings) and "access is granted but the
 * service is not running" (Android stopped it; toggling it again is the fix). Merging them produces
 * a screen that tells the user to grant something they already granted.
 *
 * Note what no branch says: "blocked", "suspended", or "Android". Ally redirects; Android does not.
 */
export function focusGuardPresentation(
  status: FocusGuardNativeStatus | null,
): FocusGuardPresentation {
  if (status === null) {
    return {
      tone: 'neutral',
      headline: 'Focus Guard needs a real phone',
      detail:
        'The mock backend has no windows to watch. Run the dev build on the device to use this.',
      actionLabel: null,
      guarding: false,
    };
  }

  if (!status.hasAccess) {
    return {
      tone: 'warning',
      headline: 'Focus Guard is not set up',
      detail:
        'Ally cannot see which app is in front, so distracting apps will open normally during ' +
        'Study Mode. Grant access in Accessibility → Installed apps → Ally Focus Guard.',
      actionLabel: 'Open accessibility settings',
      guarding: false,
    };
  }

  // Granted, but nothing is bound. Sending the user to grant it again would be nonsense.
  if (!status.serviceConnected) {
    return {
      tone: 'warning',
      headline: 'Focus Guard is not running',
      detail:
        'Access is granted but Android has not started the service. Turn Ally Focus Guard off ' +
        'and on again in Accessibility settings.',
      actionLabel: 'Open accessibility settings',
      guarding: false,
    };
  }

  const names = status.packages.map((p) => p.label);
  const list = names.length > 0 ? names.join(' and ') : 'nothing yet';

  if (!status.guarding) {
    return {
      tone: 'neutral',
      headline: 'Focus Guard is ready',
      detail: `When Study Mode starts, Ally will send you home from ${list}.`,
      actionLabel: null,
      guarding: false,
    };
  }

  /*
   * REPORTS WHAT ALLY RECORDED, NOT WHAT HAPPENED ON THE PHONE.
   *
   * This line used to read "Nothing has been opened yet", and that was a claim Ally is not in a
   * position to make. Found on the S24 Ultra: after Ally's process was killed, Android took ~5-10s
   * to rebind the service, Instagram was opened and NOT redirected during that window, and the
   * card then said nothing had been opened. It had. Ally simply never saw it.
   *
   * A redirect count is a record of Ally's own actions and is always true. Whether a restricted
   * app was opened is a fact about the phone, and only UsageStatsManager could answer it.
   */
  const last =
    status.lastLabel === null ? 'No redirects yet.' : `Last sent home from ${status.lastLabel}.`;

  return {
    tone: 'success',
    headline: 'Focus Guard is on',
    // "sends you home" and not "blocks": the app does open, and then Ally closes it.
    detail: `Opening ${list} sends you back to your home screen. ${last}`,
    actionLabel: null,
    guarding: true,
  };
}
