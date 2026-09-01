package com.ally.nativemodule

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast

/**
 * OWNER: Aayush. Task A7.2 — the Focus Guard accessibility service.
 *
 * WHAT IT DOES, AND WHAT IT CANNOT DO. It learns that a restricted app has come to the front and
 * presses Home. That is AFTER the app is already on screen. Nothing here prevents a launch, and no
 * string in this file or above it says otherwise — see the header of FocusGuard for why the
 * preventing API is permanently out of reach for an ordinary install.
 *
 * WHY IT IS ALLOWED TO PRESS HOME AT ALL. An ordinary background app cannot: background activity
 * launch restrictions (Android 10+) would reject `startActivity(CATEGORY_HOME)` from here.
 * `performGlobalAction(GLOBAL_ACTION_HOME)` is not an activity launch — it is the accessibility
 * framework performing the gesture on the user's behalf, and it works from the background. That
 * asymmetry is the entire reason this feature is an AccessibilityService and not a foreground
 * service polling UsageStatsManager, which can observe the app but cannot act on it.
 *
 * HOW LITTLE IT READS. `canRetrieveWindowContent="false"` in the service config, and the only field
 * touched on the event is `packageName`. There is no call to `getRootInActiveWindow()` anywhere in
 * this file, nothing is logged, and nothing about the screen is stored. An accessibility service is
 * a large privilege and this one is deliberately shaped to use almost none of it.
 *
 * THE ANTI-LOOP RULE (A7.3). Pressing Home produces its own window change, and a game that
 * restarts itself produces more. Redirects are therefore debounced per package: the same package
 * cannot be redirected twice inside COOLDOWN_MS. Without this the phone ends up in a Home/relaunch
 * fight that looks exactly like a crash.
 */
class FocusGuardService : AccessibilityService() {

  companion object {
    /**
     * Set by the system's own lifecycle callbacks, read by FocusGuard.isAvailable().
     *
     * This exists because the accessibility GRANT and a live BINDING are different facts, and the
     * UI has to be able to tell the user which one is missing. @Volatile because it is written on
     * the main thread and read from whichever thread the Expo module call arrives on.
     *
     * MEASURED ON SM-S928B, AND THE REASON THIS FLAG IS NOT OPTIONAL. The grant survives things
     * the binding does not:
     *
     *   - reinstalling the app (every `expo run:android`): the grant is DROPPED and the user must
     *     re-enable Focus Guard by hand. Reported by the demo phone's owner, then confirmed here.
     *   - `am kill` / ordinary process death: the grant string still lists this service, but no
     *     binding exists for roughly 5-10 seconds until Android restarts the process. Restricted
     *     apps open normally in that window.
     *   - `am force-stop`: the binding does not come back at all until Ally is opened again.
     *
     * In several of those states Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES still names us,
     * which is exactly why availability is not read from that string.
     */
    @Volatile
    var isConnected: Boolean = false
      private set

    /**
     * Long enough to cover a Home animation plus an app's own relaunch attempt, short enough that
     * a user who deliberately opens the app again a moment later is still redirected. Tuned on
     * SM-S928B; see docs/DEVICE_NOTES.md.
     */
    private const val COOLDOWN_MS = 1_200L
  }

  /** Debounce state. Instance fields, not prefs: this is per-binding and must not outlive it. */
  private var lastPackage: String? = null
  private var lastRedirectAt = 0L

  override fun onServiceConnected() {
    super.onServiceConnected()
    isConnected = true
  }

  override fun onUnbind(intent: Intent?): Boolean {
    isConnected = false
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    isConnected = false
    super.onDestroy()
  }

  /** Required by the base class. Nothing to abandon: this service holds no in-flight work. */
  override fun onInterrupt() = Unit

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

    // The ONLY field read off the event.
    val packageName = event.packageName?.toString() ?: return

    // Ally redirecting Ally would be a loop with no exit.
    if (packageName == this.packageName) return

    // Single call, and the fast path for every uninteresting window change on the phone: null means
    // either the guard is off/expired or this package is not on the list.
    val label = FocusGuard.restrictedLabel(this, packageName) ?: return

    val now = SystemClock.elapsedRealtime()
    if (packageName == lastPackage && now - lastRedirectAt < COOLDOWN_MS) return

    // Claim the slot BEFORE acting, so a burst of events during the Home transition cannot each
    // pass the check.
    lastPackage = packageName
    lastRedirectAt = now

    // Reported, not assumed. A false here means the framework refused the gesture, and recording a
    // redirect that did not happen is exactly the fake success the architecture exists to prevent.
    if (!performGlobalAction(GLOBAL_ACTION_HOME)) return

    FocusGuard.recordRedirect(this, packageName, label)

    // A plain text toast, which an app in the background is still allowed to post — custom toasts
    // are what Android 11+ blocks. Deliberately not an overlay: SYSTEM_ALERT_WINDOW was declined on
    // the demo phone, and a full-screen takeover would be a worse answer than a sentence anyway.
    // The wording says who restricted it — Ally, during Study Mode — not that Android blocked it.
    Toast.makeText(this, "$label is restricted during Study Mode.", Toast.LENGTH_LONG).show()
  }
}
