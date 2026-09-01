package com.ally.nativemodule

import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import android.provider.Settings

/**
 * OWNER: Aayush. SPIKE — is `ringer` actually implementable on SM-S928B?
 *
 * `ringer` has reported `not_supported` since Phase 2 (`pendingCapability('ringer', ..., 'T5')`).
 * This file exists to find out whether that is still the honest answer, or whether it has just
 * never been tried. It is a SPIKE: it answers a question, and nothing in the action engine calls
 * it. If the answer is no, this file is deleted and `not_supported` stays.
 *
 * WHY THE PUBLIC API MIGHT NOT BE ENOUGH. `AudioManager.setRingerMode()` is public and
 * undeprecated at API 36, but since Android N it throws `SecurityException` when the caller lacks
 * notification policy access AND the change would toggle DND — which the SILENT transitions do,
 * because silent and zen are coupled. Ally already holds ACCESS_NOTIFICATION_POLICY for DND, so
 * the interesting question is not the AOSP rule. It is whether One UI honours the write, silently
 * ignores it, or reverts it a moment later. A `setRingerMode()` that returns without throwing
 * proves nothing at all.
 *
 * SO EVERY STEP IS READ BACK TWICE, FROM TWO INDEPENDENT PLACES:
 *
 *   - `AudioManager.getRingerMode()`  — what the audio service believes
 *   - `Settings.Global.MODE_RINGER`   — what the settings provider stores
 *
 * A disagreement between them is itself a finding, and either one alone could report a write that
 * did not stick. Neither is trusted over the other and both are reported.
 *
 * THE ORIGINAL MODE IS PUT BACK IN A `finally`. This runs on someone's real phone. A spike that
 * throws halfway and leaves it on silent would cost them a missed call, so restoration is not on
 * the success path.
 */
object RingerController {

  /** Contract vocabulary (RINGER_MODES in src/types/capability.ts) ↔ AudioManager ints. */
  private const val SILENT = AudioManager.RINGER_MODE_SILENT // 0
  private const val VIBRATE = AudioManager.RINGER_MODE_VIBRATE // 1
  private const val NORMAL = AudioManager.RINGER_MODE_NORMAL // 2

  private fun audio(context: Context): AudioManager =
    context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun toName(mode: Int): String =
    when (mode) {
      SILENT -> "silent"
      VIBRATE -> "vibrate"
      NORMAL -> "normal"
      else -> "unknown($mode)"
    }

  private fun toMode(name: String): Int? =
    when (name) {
      "silent" -> SILENT
      "vibrate" -> VIBRATE
      "normal" -> NORMAL
      else -> null
    }

  /** What the AUDIO SERVICE says. */
  private fun fromAudioManager(context: Context): String =
    try {
      toName(audio(context).ringerMode)
    } catch (e: Exception) {
      "error(${e.javaClass.simpleName})"
    }

  /**
   * What the SETTINGS PROVIDER says. Deliberately a second, independent source: if One UI accepts
   * the call and then reverts it, or accepts it in one place only, these two disagree and the
   * disagreement is the actual finding.
   */
  private fun fromSettings(context: Context): String =
    try {
      toName(Settings.Global.getInt(context.contentResolver, "mode_ringer"))
    } catch (e: Exception) {
      "unreadable(${e.javaClass.simpleName})"
    }

  fun isAvailable(context: Context): Boolean =
    try {
      audio(context)
      true
    } catch (e: Exception) {
      false
    }

  fun currentMode(context: Context): String = fromAudioManager(context)

  /** Whether Ally holds the grant the SILENT transitions need. Reported, never assumed. */
  fun hasPolicyAccess(context: Context): Boolean =
    try {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .isNotificationPolicyAccessGranted
    } catch (e: Exception) {
      false
    }

  private fun dndFilter(context: Context): String =
    try {
      when (
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .currentInterruptionFilter
      ) {
        NotificationManager.INTERRUPTION_FILTER_ALL -> "all"
        NotificationManager.INTERRUPTION_FILTER_PRIORITY -> "priority"
        NotificationManager.INTERRUPTION_FILTER_ALARMS -> "alarms"
        NotificationManager.INTERRUPTION_FILTER_NONE -> "none"
        else -> "unknown"
      }
    } catch (e: Exception) {
      "unreadable"
    }

  /**
   * One transition, attempted and then verified.
   *
   * `ok` is NOT "the call returned". It is "both independent reads agree the phone is in the mode
   * we asked for". That distinction is the entire point of the spike — a write that throws nothing
   * and changes nothing is the exact failure mode this is looking for.
   */
  private fun step(context: Context, label: String, requested: String, dwellMs: Long): Map<String, Any?> {
    val target = toMode(requested)
    val beforeAudio = fromAudioManager(context)
    val beforeSettings = fromSettings(context)
    var error: String? = null
    var threw = false

    if (target == null) {
      error = "unknown mode"
    } else {
      try {
        audio(context).ringerMode = target
      } catch (e: SecurityException) {
        threw = true
        error = "SecurityException"
      } catch (e: Exception) {
        threw = true
        error = e.javaClass.simpleName
      }
    }

    // Dwell so the value can be sampled from outside the app while it is meant to be in effect,
    // and so a revert-after-a-moment has time to happen where it would otherwise be missed.
    try {
      Thread.sleep(dwellMs)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
    }

    val afterAudio = fromAudioManager(context)
    val afterSettings = fromSettings(context)

    return mapOf(
      "step" to label,
      "requested" to requested,
      "beforeAudioManager" to beforeAudio,
      "beforeSettings" to beforeSettings,
      "afterAudioManager" to afterAudio,
      "afterSettings" to afterSettings,
      "agree" to (afterAudio == afterSettings),
      "ok" to (!threw && afterAudio == requested && afterSettings == requested),
      "threw" to threw,
      "error" to error,
      "dndFilter" to dndFilter(context),
    )
  }

  /**
   * The matrix the investigation asks for, run against the real phone.
   *
   *   normal  → silent → back to normal
   *   vibrate → silent → back to vibrate
   *   silent  → silent → back to silent     (the no-op case, which must not report a false change)
   *
   * The caller sets DND before invoking, so the same matrix can be run with the filter off and on.
   * The user's original mode is restored in `finally`, whatever happens.
   */
  fun spike(context: Context, dwellMs: Long): Map<String, Any?> {
    val original = fromAudioManager(context)
    val steps = mutableListOf<Map<String, Any?>>()

    return try {
      for (start in listOf("normal", "vibrate", "silent")) {
        steps.add(step(context, "arrange:$start", start, dwellMs))
        steps.add(step(context, "$start->silent", "silent", dwellMs))
        steps.add(step(context, "$start:restore", start, dwellMs))
      }

      mapOf(
        "originalMode" to original,
        "policyAccess" to hasPolicyAccess(context),
        "dndFilter" to dndFilter(context),
        "steps" to steps,
        "restoredTo" to fromAudioManager(context),
      )
    } finally {
      // Not on the success path. This is someone's real phone.
      toMode(original)?.let {
        try {
          audio(context).ringerMode = it
        } catch (e: Exception) {
          // Nothing further to try; the report carries `restoredTo` so the truth is visible.
        }
      }
    }
  }
}
