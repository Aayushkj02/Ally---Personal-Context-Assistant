package com.ally.nativemodule

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings

/**
 * OWNER: Aayush. Task T4 — brightness.
 *
 * The contract (src/types/capability.ts) expresses brightness as an integer PERCENT 0..100,
 * but Android stores a raw value in Settings.System.SCREEN_BRIGHTNESS. Converting
 * raw -> percent -> raw loses up to one raw unit to rounding, so "restore to exactly 73"
 * would return 186 where the user had 187.
 *
 * We therefore remember the EXACT raw value captured at snapshot time and write that back
 * when the restore target matches the snapshotted percent. The percent stays the contract
 * currency; the raw value is how we keep the promise.
 *
 * THAT MEMORY IS ON DISK, NOT IN THE HEAP (ADR-116). A context can outlive the process — the
 * user starts Study, Android kills the app, they reopen it and end the context an hour later.
 * An in-heap cache is empty by then and restore silently falls back to toRaw(73) = 186, one
 * unit off the 187 they started from. That is a quiet lie of exactly the kind this codebase
 * exists to prevent, so the raw value and the original brightness mode live in
 * SharedPreferences and are written with commit(), not apply(), because the very scenario
 * being defended against is the process dying before an async flush completes.
 *
 * ADAPTIVE BRIGHTNESS: if the device is in automatic mode, the light sensor overwrites any
 * manual value within moments — a write that "succeeds" and then silently reverts, which is
 * exactly the false success the architecture exists to prevent. We snapshot the mode, switch
 * to manual to apply, and put the user's mode back on restore.
 */
object BrightnessController {

  /** Settings.System.SCREEN_BRIGHTNESS range on this device. Verified on SM-S928B. */
  private const val RAW_MAX = 255

  private const val PREFS = "ally_brightness"
  /** Exact raw value, keyed by the percent it reports as: "raw_73" -> 187. */
  private const val KEY_RAW_PREFIX = "raw_"
  /** The user's SCREEN_BRIGHTNESS_MODE from before Ally touched anything. */
  private const val KEY_MODE = "snap_mode"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * Remembers the exact raw value for a percent.
   *
   * Keyed BY PERCENT, not a single slot: the UI re-snapshots after each change to refresh its
   * display, and one slot would clobber the original. Caught on device — restoring 73% returned
   * raw 186 instead of the 187 we started from, because by then the slot held 30%/77.
   *
   * Last write wins for a given percent, deliberately. snapshot() runs immediately before each
   * apply and reports what is true right then, so the newest reading for a percent IS the
   * correct one. Session-scoped first-write-wins is enforced a layer up, in SnapshotStore.
   */
  private fun rememberRaw(context: Context, percent: Int, raw: Int) {
    prefs(context).edit().putInt(KEY_RAW_PREFIX + percent, raw).commit()
  }

  private fun recallRaw(context: Context, percent: Int): Int? {
    val p = prefs(context)
    val key = KEY_RAW_PREFIX + percent
    return if (p.contains(key)) p.getInt(key, -1).takeIf { it >= 0 } else null
  }

  /** First write wins, and a successful restore clears it so the next context captures fresh. */
  private fun rememberMode(context: Context, mode: Int) {
    val p = prefs(context)
    if (!p.contains(KEY_MODE)) p.edit().putInt(KEY_MODE, mode).commit()
  }

  private fun recallMode(context: Context): Int? {
    val p = prefs(context)
    return if (p.contains(KEY_MODE)) p.getInt(KEY_MODE, -1).takeIf { it >= 0 } else null
  }

  private fun forgetMode(context: Context) {
    prefs(context).edit().remove(KEY_MODE).commit()
  }

  private fun toPercent(raw: Int): Int = Math.round(raw * 100f / RAW_MAX).coerceIn(0, 100)
  private fun toRaw(percent: Int): Int = Math.round(percent.coerceIn(0, 100) * RAW_MAX / 100f)

  fun isAvailable(context: Context): Boolean =
    readRaw(context) != null

  fun hasPermission(context: Context): Boolean = Settings.System.canWrite(context)

  private fun readRaw(context: Context): Int? = try {
    Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS)
  } catch (_: Throwable) {
    null
  }

  private fun readMode(context: Context): Int? = try {
    Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE)
  } catch (_: Throwable) {
    null
  }

  /** Reading brightness needs no permission. Returns percent, and caches the exact raw value. */
  fun snapshot(context: Context): Map<String, Any?> {
    val raw = readRaw(context)
      ?: return mapOf("ok" to false, "reason" to "unsupported", "percent" to null, "raw" to null)
    val percent = toPercent(raw)
    rememberRaw(context, percent, raw)
    readMode(context)?.let { rememberMode(context, it) }
    return mapOf(
      "ok" to true,
      "reason" to null,
      "percent" to percent,
      "raw" to raw,
      "autoMode" to (readMode(context) == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC),
    )
  }

  fun apply(context: Context, percent: Int): Map<String, Any?> =
    write(context, percent, toRaw(percent), restoreMode = false)

  /**
   * Restores the user's brightness. When the target matches what we snapshotted we write the
   * EXACT raw value back rather than a value re-derived from the percent, and we put the
   * original brightness mode back too.
   */
  fun restore(context: Context, percent: Int): Map<String, Any?> {
    val exactRaw = recallRaw(context, percent)
    val out = write(context, percent, exactRaw ?: toRaw(percent), restoreMode = true)

    // `exact` is the A-V2 proof: true means we wrote the raw value we actually captured, false
    // means we had to reconstruct it from the percent and may be a unit off. Never inferred
    // from the result — reported from whether the stored value was there.
    val exact = exactRaw != null
    if (out["ok"] == true && exact) forgetMode(context)

    return out + mapOf("exact" to exact, "restoredRaw" to (exactRaw ?: toRaw(percent)))
  }

  private fun write(context: Context, percent: Int, raw: Int, restoreMode: Boolean): Map<String, Any?> {
    val beforeRaw = readRaw(context)
    val before = beforeRaw?.let { toPercent(it) }

    if (!Settings.System.canWrite(context)) {
      // Checked before any write. A denied permission must leave the device untouched.
      return result(false, "permission", before, before, beforeRaw, beforeRaw,
        "Permission to modify system settings is needed before Ally can change brightness.")
    }

    return try {
      // Adaptive brightness would silently undo a manual write, so pin to manual first.
      Settings.System.putInt(
        context.contentResolver,
        Settings.System.SCREEN_BRIGHTNESS_MODE,
        Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL,
      )
      Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, raw)

      if (restoreMode) {
        recallMode(context)?.let {
          Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, it)
        }
      }

      Thread.sleep(150)

      // READ-BACK. Only a confirmed write counts.
      val afterRaw = readRaw(context)
      val after = afterRaw?.let { toPercent(it) }
      if (afterRaw == raw) {
        result(true, null, before, after, beforeRaw, afterRaw, "Brightness set to $after%.")
      } else {
        result(false, "mismatch", before, after, beforeRaw, afterRaw,
          "Brightness reads $after% rather than $percent%.")
      }
    } catch (t: Throwable) {
      val afterRaw = readRaw(context)
      result(false, "error", before, afterRaw?.let { toPercent(it) }, beforeRaw, afterRaw,
        t.message ?: "Brightness change failed.")
    }
  }

  private fun result(
    ok: Boolean, reason: String?, before: Int?, after: Int?,
    beforeRaw: Int?, afterRaw: Int?, message: String,
  ) = mapOf(
    "ok" to ok, "reason" to reason,
    "before" to before, "after" to after,
    // Raw values are how we prove restoration was exact, not merely close.
    "beforeRaw" to beforeRaw, "afterRaw" to afterRaw,
    "message" to message, "rung" to "settings_system",
  )
}
