package com.ally.nativemodule

import android.content.Context
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
 * ADAPTIVE BRIGHTNESS: if the device is in automatic mode, the light sensor overwrites any
 * manual value within moments — a write that "succeeds" and then silently reverts, which is
 * exactly the false success the architecture exists to prevent. We snapshot the mode, switch
 * to manual to apply, and put the user's mode back on restore.
 */
object BrightnessController {

  /** Settings.System.SCREEN_BRIGHTNESS range on this device. Verified on SM-S928B. */
  private const val RAW_MAX = 255

  /**
   * Every raw value we have observed, keyed by the percent it reports as.
   *
   * A single slot is not enough: the UI re-snapshots after each change to refresh its display,
   * which would clobber the original. Caught on device — restoring 73% returned raw 186 instead
   * of the 187 we started from, because by then the slot held 30%/77.
   */
  private val rawByPercent = HashMap<Int, Int>()
  private var snapMode: Int? = null

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
    rawByPercent[percent] = raw
    if (snapMode == null) snapMode = readMode(context)
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
    val exactRaw = rawByPercent[percent]
    return write(context, percent, exactRaw ?: toRaw(percent), restoreMode = true)
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
        snapMode?.let {
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
