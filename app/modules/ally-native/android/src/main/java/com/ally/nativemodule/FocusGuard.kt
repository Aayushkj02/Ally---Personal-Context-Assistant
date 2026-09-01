package com.ally.nativemodule

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityManager

/**
 * OWNER: Aayush. Task A7.1 — Study Mode Focus Guard state.
 *
 * WHAT THIS IS, IN ONE LINE: a reactive redirect, not a block. Ally cannot stop an app from
 * starting; it can only notice that one HAS started and send the user home afterwards.
 *
 * READ THIS BEFORE CHANGING ANY COPY NEAR IT. The device spike (docs/DEVICE_NOTES.md) established
 * that real package suspension needs `android.permission.SUSPEND_APPS`, whose protection level on
 * SM-S928B / API 36 is `signature|verifier|role`, plus device-owner on user 0. Ally is an ordinary
 * `/data/app` install with no owner, so that door is closed permanently — not "not yet". Samsung's
 * own App Timer does it from `/system/priv-app/DigitalWellbeing` with the PRIVILEGED flag. This
 * feature must therefore never say "Android blocked this app", because Android did not: Ally
 * pressed Home. Every string in here is worded to keep that distinction true.
 *
 * WHY STATE LIVES IN SHAREDPREFERENCES AND NOT IN JS. FocusGuardService is bound by the SYSTEM,
 * not by Ally, so it runs whether or not React Native is alive — after a process death the service
 * is rebound and JS is not. If the restricted list lived in JS the guard would either stop working
 * or, worse, keep firing with nothing able to say what it was guarding. Native prefs are the only
 * store both the service and the module can read at any moment.
 *
 * THREE THINGS KEEP THAT STATE FROM GOING STALE (the A7.4 requirement):
 *   1. `expiresAt` — the session's own end time. An active guard whose session has expired switches
 *      itself off on the next read, so a killed Ally cannot leave the phone restricted forever.
 *   2. The app shell reconciles on every context refresh against the DATABASE, which is the source
 *      of truth for whether a study session is running. See App.tsx.
 *   3. `active` is a flag, `guarding` is a decision. Callers get both, so "the user turned it on"
 *      and "it is restricting right now" can never be confused.
 */
object FocusGuard {
  private const val PREFS = "ally_focus_guard"
  private const val KEY_ACTIVE = "active"
  private const val KEY_ENTRIES = "entries"
  private const val KEY_EXPIRES_AT = "expires_at"
  private const val KEY_LAST_PACKAGE = "last_package"
  private const val KEY_LAST_LABEL = "last_label"
  private const val KEY_LAST_AT = "last_at"
  private const val KEY_REDIRECTS = "redirects"

  /** "pkg|label" per line. Neither field may contain the separators; both are sanitised on write. */
  private const val FIELD_SEP = "|"
  private const val RECORD_SEP = "\n"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---- availability -------------------------------------------------------------------------

  private fun component(context: Context) =
    ComponentName(context.packageName, FocusGuardService::class.java.name)

  /**
   * Has the user granted accessibility access to THIS service?
   *
   * Asked through AccessibilityManager rather than by string-matching
   * `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`, which is the usual recipe and a worse answer:
   * that setting is a colon-joined list which can name a service in either short or long form, and
   * it reports what was requested rather than what the system actually bound.
   */
  fun hasAccess(context: Context): Boolean {
    val manager =
      context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
        ?: return false
    val mine = component(context)
    return manager
      .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      .any {
        val info = it.resolveInfo?.serviceInfo
        info != null && info.packageName == mine.packageName && info.name == mine.className
      }
  }

  /**
   * The read-back, and the reason this feature can be trusted when it says "unavailable".
   *
   * `hasAccess()` reports a GRANT. `FocusGuardService.isConnected` reports that the system has
   * actually bound and connected our service. The two disagree in a real, reachable case: the
   * moment after the user flips the toggle, and again after Android stops a service while leaving
   * the grant in place. Availability requires both, in the same spirit as DndController reading the
   * mode back instead of trusting its own write.
   */
  fun isAvailable(context: Context): Boolean = hasAccess(context) && FocusGuardService.isConnected

  /**
   * Opens Android's accessibility list.
   *
   * There is no public deep link to a single service's own toggle — `ACTION_ACCESSIBILITY_SETTINGS`
   * is as close as the SDK gets, and on One UI the user still has to walk
   * Installed apps → Ally → toggle. The UI copy spells that walk out rather than pretending this
   * button lands on the switch itself.
   */
  fun openSettings(context: Context): Boolean {
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    return true
  }

  // ---- state --------------------------------------------------------------------------------

  /**
   * A restricted app as the CALLER named it.
   *
   * The label is supplied, never resolved from the package manager. Resolving it would mean
   * `getApplicationLabel()`, which at targetSdk 30+ needs the package declared in `<queries>` or
   * QUERY_ALL_PACKAGES — a real permission, asked for so a toast could be prettier. The caller
   * already knows the name it put in the list.
   */
  data class Entry(val packageName: String, val label: String)

  private fun sanitise(value: String): String =
    value.replace(FIELD_SEP, " ").replace("\n", " ").replace("\r", " ").trim()

  private fun readEntries(context: Context): List<Entry> =
    prefs(context)
      .getString(KEY_ENTRIES, "")
      .orEmpty()
      .split(RECORD_SEP)
      .mapNotNull { line ->
        if (line.isBlank()) return@mapNotNull null
        val parts = line.split(FIELD_SEP, limit = 2)
        val pkg = parts.getOrNull(0)?.trim().orEmpty()
        if (pkg.isEmpty()) return@mapNotNull null
        Entry(pkg, parts.getOrNull(1)?.trim().orEmpty().ifEmpty { pkg })
      }

  /**
   * Is the guard restricting anything RIGHT NOW?
   *
   * Self-healing: an active guard whose session end time has passed is switched off here, on read,
   * so nothing has to remember to come back and tidy up. `expiresAt == 0` means open-ended, which
   * is only reachable for a session Dhrey's store is also holding open.
   */
  fun isGuarding(context: Context): Boolean {
    val p = prefs(context)
    if (!p.getBoolean(KEY_ACTIVE, false)) return false
    val expiresAt = p.getLong(KEY_EXPIRES_AT, 0L)
    if (expiresAt > 0L && System.currentTimeMillis() >= expiresAt) {
      p.edit().putBoolean(KEY_ACTIVE, false).apply()
      return false
    }
    return true
  }

  /**
   * The service's hot path: is this package restricted, and what do we call it?
   *
   * Returns null for "leave it alone", which is the answer for nearly every window change on the
   * phone. One prefs read (in memory after the first) and a scan of a two-item list, so an
   * uninteresting event costs close to nothing.
   */
  fun restrictedLabel(context: Context, packageName: String): String? {
    if (!isGuarding(context)) return null
    return readEntries(context).firstOrNull { it.packageName == packageName }?.label
  }

  /** Turns the guard on for a session. Clears the previous run's counters so the UI cannot lie. */
  fun activate(context: Context, entries: List<Entry>, expiresAt: Long): Map<String, Any?> {
    val serialised =
      entries
        .filter { it.packageName.isNotBlank() }
        .joinToString(RECORD_SEP) { "${sanitise(it.packageName)}$FIELD_SEP${sanitise(it.label)}" }

    prefs(context)
      .edit()
      // An empty list is not a guard. Storing `active = true` with nothing to guard would report
      // "restricting" on a phone where every app opens normally.
      .putBoolean(KEY_ACTIVE, entries.isNotEmpty())
      .putString(KEY_ENTRIES, serialised)
      .putLong(KEY_EXPIRES_AT, if (expiresAt > 0L) expiresAt else 0L)
      .remove(KEY_LAST_PACKAGE)
      .remove(KEY_LAST_LABEL)
      .remove(KEY_LAST_AT)
      .putInt(KEY_REDIRECTS, 0)
      .apply()

    return status(context)
  }

  /** Turns the guard off. The list is kept, so the UI can still say what it WOULD restrict. */
  fun deactivate(context: Context): Map<String, Any?> {
    prefs(context).edit().putBoolean(KEY_ACTIVE, false).apply()
    return status(context)
  }

  /** Called by the service after a redirect has actually happened. */
  fun recordRedirect(context: Context, packageName: String, label: String) {
    val p = prefs(context)
    p.edit()
      .putString(KEY_LAST_PACKAGE, packageName)
      .putString(KEY_LAST_LABEL, label)
      .putLong(KEY_LAST_AT, System.currentTimeMillis())
      .putInt(KEY_REDIRECTS, p.getInt(KEY_REDIRECTS, 0) + 1)
      .apply()
  }

  /**
   * Everything the UI needs, with the grant and the binding reported SEPARATELY.
   *
   * A single `available` boolean would hide the one state the user has to act on: access granted
   * but the service not connected. That has to be distinguishable from "you have not granted
   * anything yet", because the fix is different.
   */
  fun status(context: Context): Map<String, Any?> {
    val p = prefs(context)
    val entries = readEntries(context)
    val lastAt = p.getLong(KEY_LAST_AT, 0L)

    return mapOf(
      "hasAccess" to hasAccess(context),
      "serviceConnected" to FocusGuardService.isConnected,
      "available" to isAvailable(context),
      // The stored flag, untouched by expiry — what the user last asked for.
      "active" to p.getBoolean(KEY_ACTIVE, false),
      // The decision, expiry applied — what is actually happening.
      "guarding" to isGuarding(context),
      "expiresAt" to p.getLong(KEY_EXPIRES_AT, 0L).toDouble(),
      "packages" to entries.map { mapOf("package" to it.packageName, "label" to it.label) },
      "redirects" to p.getInt(KEY_REDIRECTS, 0),
      "lastPackage" to p.getString(KEY_LAST_PACKAGE, null),
      "lastLabel" to p.getString(KEY_LAST_LABEL, null),
      "lastAt" to if (lastAt > 0L) lastAt.toDouble() else null,
    )
  }
}
