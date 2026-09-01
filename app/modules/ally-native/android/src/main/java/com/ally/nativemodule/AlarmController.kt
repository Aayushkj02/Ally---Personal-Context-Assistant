package com.ally.nativemodule

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.provider.AlarmClock
import java.util.Calendar

/**
 * OWNER: Aayush. Task A5.1 — the wake-up alarm.
 *
 * USES android.provider.AlarmClock, NOT AlarmManager (ADR-127). This is the whole decision.
 * `AlarmManager` schedules an alarm that belongs to Ally: it never appears in the Clock app, it
 * dies with the app's data, and the user cannot see, edit or silence it from anywhere they would
 * think to look. Phase 5 asks for a REAL wake-up alarm, so we hand the request to the phone's own
 * Clock through `ACTION_SET_ALARM` and Android owns it from that moment on. Verified on API 36 and
 * resolved on SM-S928B to `com.sec.android.app.clockpackage`.
 *
 * THERE IS NO PUBLIC READ-BACK, and this file does not pretend otherwise. `AlarmClock` exposes
 * SET, DISMISS and SHOW; there is no provider and no `getAlarms()`. Everywhere else in this
 * codebase `applied` means "we wrote it and then read it back" (PRD §20, NFR-03). Here that is
 * impossible, so what is verified instead is stated exactly:
 *
 *   1. a real Clock activity RESOLVES for the intent, and
 *   2. `startActivity` accepted it without throwing.
 *
 * The message says "Sent to your Clock app" rather than "your alarm is set", because the second is
 * a claim we cannot check. Whether the alarm truly exists, at the right time, with the right
 * recurrence, is proved by opening the stock Clock during device testing — that observation is the
 * acceptance evidence, and it is recorded in docs/DEVICE_NOTES.md.
 *
 * IDENTITY IS THE LABEL. Every alarm Ally creates is labelled `Ally wake-up`, and dismissal
 * searches by that label (`ALARM_SEARCH_MODE_LABEL`). That is the only handle the platform gives
 * us, and it is what guarantees the user's own 6am work alarm is never touched — we cannot address
 * it even by accident, because we can only ever name our own.
 */
object AlarmController {

  /** Ally's alarms carry this label. It is the identity dismissal searches for. */
  const val LABEL = "Ally wake-up"

  /** Normal, install-time permission. ACTION_SET_ALARM needs it; SCHEDULE_EXACT_ALARM does not apply. */
  private const val SET_ALARM_PERMISSION = "com.android.alarm.permission.SET_ALARM"

  /**
   * What Ally last asked the Clock for, per session — the idempotency record (ADR-127).
   *
   * ON DISK, for the same reason every other borrowed value is (ADR-116/120/124): the duplicate
   * this defends against can arrive after a process death, and an in-heap flag would be empty by
   * then. `commit()` rather than `apply()`, because the scenario being defended against is the
   * process dying before an async flush lands.
   */
  private const val PREFS = "ally_alarm"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** "07:00|weekdays" — time and recurrence together, because either one differing is a new alarm. */
  private fun identity(hour: Int, minute: Int, weekdays: Boolean): String =
    String.format("%02d:%02d|%s", hour, minute, if (weekdays) "weekdays" else "once")

  private fun setIntent(): Intent = Intent(AlarmClock.ACTION_SET_ALARM)

  /** Which Clock app would handle this, or null when nothing does. */
  private fun handler(context: Context, intent: Intent): String? =
    context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
      ?.activityInfo?.packageName

  /**
   * Available when a real Clock activity resolves for ACTION_SET_ALARM.
   *
   * NOTE FOR targetSdk 30+: this returns null unless the manifest declares a `<queries>` entry for
   * the action, even on a phone that obviously has a Clock. A missing `<queries>` entry looks
   * exactly like "no Clock app installed", so the manifest change is not optional.
   */
  fun isAvailable(context: Context): Boolean = handler(context, setIntent()) != null

  fun hasPermission(context: Context): Boolean =
    context.checkSelfPermission(SET_ALARM_PERMISSION) == PackageManager.PERMISSION_GRANTED

  /** Monday–Friday, in the Calendar constants EXTRA_DAYS expects. */
  private fun weekdayList(): ArrayList<Int> = arrayListOf(
    Calendar.MONDAY,
    Calendar.TUESDAY,
    Calendar.WEDNESDAY,
    Calendar.THURSDAY,
    Calendar.FRIDAY,
  )

  /**
   * Asks the Clock app for a wake-up alarm.
   *
   * `weekdays` comes from the user's own words, resolved upstream — this file never infers
   * recurrence. A request without it produces a one-shot alarm and EXTRA_DAYS is not sent at all,
   * so an omitted recurrence cannot become an accidental daily alarm.
   *
   * `sessionId` scopes the idempotency record. The Sleep plan currently contains the same alarm
   * action twice (once resolved from the command, once appended from the schedule), so asking for
   * the identical alarm again inside one session is normal traffic, not an error — it reports
   * `skipped` and sends nothing.
   */
  fun set(
    context: Context,
    hour: Int,
    minute: Int,
    weekdays: Boolean,
    sessionId: String,
  ): Map<String, Any?> {
    if (hour !in 0..23 || minute !in 0..59) {
      return result(false, "invalid", "\"$hour:$minute\" is not a time of day.")
    }

    val intent = setIntent()
    val target = handler(context, intent)
      ?: return result(false, "unsupported", "This phone has no Clock app that Ally can set an alarm in.")

    if (!hasPermission(context)) {
      // Checked before anything is sent. A denied permission leaves the Clock untouched.
      return result(false, "permission", "Ally needs permission to set alarms.")
    }

    val wanted = identity(hour, minute, weekdays)
    if (prefs(context).getString(sessionId, null) == wanted) {
      return result(
        true, "duplicate", "That alarm was already sent to your Clock app.",
        target = target, identity = wanted, skipped = true,
      )
    }

    intent.putExtra(AlarmClock.EXTRA_HOUR, hour)
      .putExtra(AlarmClock.EXTRA_MINUTES, minute)
      .putExtra(AlarmClock.EXTRA_MESSAGE, LABEL)
      // Without this the Clock app opens its own editor and waits for a tap, which is not an
      // alarm — it is a form. Some OEMs ignore it; the device test is what tells us.
      .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    if (weekdays) intent.putExtra(AlarmClock.EXTRA_DAYS, weekdayList())

    return try {
      context.startActivity(intent)

      // Recorded only after the Clock accepted it, so a refusal stays retryable.
      prefs(context).edit().putString(sessionId, wanted).commit()

      result(
        true, null,
        "Sent to your Clock app: $LABEL at ${"%02d:%02d".format(hour, minute)}" +
          if (weekdays) ", weekdays." else ".",
        target = target, identity = wanted,
      )
    } catch (t: Throwable) {
      result(false, "error", t.message ?: "Your Clock app would not take the alarm.", target = target)
    }
  }

  /**
   * Asks the Clock to dismiss the alarm Ally created, and nothing else.
   *
   * Scoped by LABEL, which is the only targeting the platform offers and is also the safety
   * property: there is no expression here that could name the user's own alarms.
   *
   * WHAT "DISMISS" MEANS IS THE PLATFORM'S TO DECIDE, and it is not the same as delete. For a
   * recurring alarm the documented behaviour is to dismiss the upcoming occurrence, so a weekday
   * alarm may well survive as a rule. That is a real limitation, reported rather than papered
   * over, and what the Samsung actually does is recorded in DEVICE_NOTES.
   */
  fun dismiss(context: Context, sessionId: String?): Map<String, Any?> {
    val intent = Intent(AlarmClock.ACTION_DISMISS_ALARM)
    val target = handler(context, intent)
      ?: return result(false, "unsupported", "This phone has no Clock app that Ally can ask.")

    if (!hasPermission(context)) {
      return result(false, "permission", "Ally needs permission to change alarms.")
    }

    intent.putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_LABEL)
      .putExtra(AlarmClock.EXTRA_MESSAGE, LABEL)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    return try {
      context.startActivity(intent)
      // The record goes with it: whatever the Clock did, Ally is no longer holding this identity,
      // so the next request must be sent rather than skipped as a duplicate.
      if (sessionId != null) prefs(context).edit().remove(sessionId).commit()
      result(true, null, "Asked your Clock app to dismiss $LABEL.", target = target)
    } catch (t: Throwable) {
      result(false, "error", t.message ?: "Your Clock app would not dismiss the alarm.", target = target)
    }
  }

  /** Opens the Clock's own alarm list — how a human verifies what no API will tell us. */
  fun showAlarms(context: Context): Boolean = try {
    context.startActivity(
      Intent(AlarmClock.ACTION_SHOW_ALARMS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    true
  } catch (_: Throwable) {
    false
  }

  /** Forgets a session's idempotency record. Used when a context ends. */
  fun forgetSession(context: Context, sessionId: String) {
    prefs(context).edit().remove(sessionId).commit()
  }

  fun debugState(context: Context): Map<String, Any?> = mapOf(
    "available" to isAvailable(context),
    "permissionGranted" to hasPermission(context),
    "setHandler" to handler(context, setIntent()),
    "dismissHandler" to handler(context, Intent(AlarmClock.ACTION_DISMISS_ALARM)),
    "label" to LABEL,
    "remembered" to prefs(context).all,
    // Stated in the diagnostics too, so nobody goes looking for a read-back that is not there.
    "readBackSupported" to false,
  )

  private fun result(
    ok: Boolean,
    reason: String?,
    message: String,
    target: String? = null,
    identity: String? = null,
    skipped: Boolean = false,
  ) = mapOf(
    "ok" to ok,
    "reason" to reason,
    "message" to message,
    // Which Clock app took it. Named so a failure can be told apart from a missing Clock.
    "clockPackage" to target,
    "identity" to identity,
    "skipped" to skipped,
    "rung" to "alarm_clock_intent",
  )
}
