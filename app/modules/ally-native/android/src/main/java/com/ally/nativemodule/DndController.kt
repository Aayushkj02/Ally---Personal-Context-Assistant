package com.ally.nativemodule

import android.app.AutomaticZenRule
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.service.notification.Condition
import android.service.notification.ZenPolicy

/**
 * OWNER: Aayush. Task T3 — the DND capability.
 *
 * IMPLEMENTS ADR-102 RUNG 1. Our app targets SDK 36, and Android forbids apps targeting
 * API 35+ from setting the global interruption filter directly. So we do not try:
 * we own ONE AutomaticZenRule and toggle its state, and Android combines our rule with
 * whatever else is active to decide the effective filter.
 *
 * That combination is why we never assert what the filter "should" be. Every call reads
 * NotificationManager.getCurrentInterruptionFilter() back afterwards and reports what the
 * device actually did (PRD 20 / NFR-03 — never fake success).
 *
 * The rule is identified by a stable conditionId rather than by name, so relaunching the
 * app reuses the same rule instead of accumulating duplicates in the user's settings.
 *
 * DEVICE FINDING (T3, ADR-105): addAutomaticZenRule() is REJECTED with
 * "Rule must have a ConditionProviderService and/or configuration activity" unless the rule
 * names one. We supply MainActivity as the configurationActivity, which is also what makes
 * the rule tappable from Android's own Do Not Disturb settings.
 */
object DndController {

  private const val RULE_NAME = "Ally"
  private val CONDITION_ID: Uri = Uri.parse("condition://com.ally.assistant/ally")

  /** setAutomaticZenRuleState arrived in API 30. Below that we report unavailable, not broken. */
  private const val MIN_SDK = Build.VERSION_CODES.R

  private fun nm(context: Context): NotificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun isAvailable(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < MIN_SDK) return false
    return try {
      nm(context).currentInterruptionFilter
      true
    } catch (_: Throwable) {
      false
    }
  }

  fun hasPermission(context: Context): Boolean = nm(context).isNotificationPolicyAccessGranted

  /** Effective device-wide mode, which may reflect rules other than ours. */
  fun currentMode(context: Context): String = toMode(nm(context).currentInterruptionFilter)

  private fun toFilter(mode: String): Int = when (mode) {
    "priority" -> NotificationManager.INTERRUPTION_FILTER_PRIORITY
    "alarms_only" -> NotificationManager.INTERRUPTION_FILTER_ALARMS
    "total_silence" -> NotificationManager.INTERRUPTION_FILTER_NONE
    else -> NotificationManager.INTERRUPTION_FILTER_ALL
  }

  private fun toMode(filter: Int): String = when (filter) {
    NotificationManager.INTERRUPTION_FILTER_PRIORITY -> "priority"
    NotificationManager.INTERRUPTION_FILTER_ALARMS -> "alarms_only"
    NotificationManager.INTERRUPTION_FILTER_NONE -> "total_silence"
    else -> "off"
  }

  private fun findOurRuleId(manager: NotificationManager): String? =
    try {
      manager.automaticZenRules.entries.firstOrNull { it.value.conditionId == CONDITION_ID }?.key
    } catch (_: Throwable) {
      null
    }

  /** Priority mode still lets alarms and media through — silence should not kill your alarm. */
  private fun policyFor(mode: String): ZenPolicy? =
    if (mode == "priority") {
      ZenPolicy.Builder()
        .allowAlarms(true)
        .allowMedia(true)
        .build()
    } else {
      null
    }

  /**
   * Android requires every AutomaticZenRule to name a ConditionProviderService owner OR a
   * configuration activity. We are an app-managed rule (we drive state ourselves via
   * setAutomaticZenRuleState), so we use the configuration activity. It must live in our
   * own package or the platform rejects it.
   */
  private fun configActivity(context: Context) =
    ComponentName(context.packageName, "${'$'}{context.packageName}.MainActivity")

  private fun buildRule(context: Context, mode: String): AutomaticZenRule {
    val filter = toFilter(mode)
    val policy = policyFor(mode)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      AutomaticZenRule.Builder(RULE_NAME, CONDITION_ID)
        .setInterruptionFilter(filter)
        .setConfigurationActivity(configActivity(context))
        .apply { if (policy != null) setZenPolicy(policy) }
        .setEnabled(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      AutomaticZenRule(RULE_NAME, null, configActivity(context), CONDITION_ID, policy, filter, true)
    }
  }

  /**
   * Apply a mode and report what the device actually ended up in.
   *
   * Returns ok=false with a reason and NO mutation attempted when permission is missing —
   * a denied permission must never leave the device half-changed.
   */
  fun apply(context: Context, mode: String): Map<String, Any?> {
    if (!isAvailable(context)) {
      return result(false, "unsupported", null, null, "Do Not Disturb control is not available on this device.", "none")
    }

    val manager = nm(context)
    val before = toMode(manager.currentInterruptionFilter)

    if (!manager.isNotificationPolicyAccessGranted) {
      // Deliberately BEFORE any write. No partial mutation on a denied permission.
      return result(false, "permission", before, before, "Do Not Disturb access is needed before Ally can change this.", "none")
    }

    // RUNG 1: AutomaticZenRule. Correct for targetSdk 35+, but rejected on some OEM builds.
    //
    // A rung only counts as working if the DEVICE ACTUALLY REACHED the target. Throwing no
    // exception is not enough: deactivating a rule that was never registered is a silent
    // no-op, which previously short-circuited the ladder and left the phone in the wrong
    // state while still reporting truthfully. If the read-back disagrees, fall through.
    var rung1Error = tryZenRule(context, manager, mode)
    if (rung1Error == null) {
      val after = toMode(manager.currentInterruptionFilter)
      if (after == mode) {
        return result(true, null, before, after, "Interruptions set to $mode.", "zen_rule")
      }
      rung1Error = "zen rule left the device in \"$after\""
    }

    // RUNG 2: legacy setInterruptionFilter. ADR-102's documented escape hatch.
    return try {
      manager.setInterruptionFilter(toFilter(mode))
      Thread.sleep(250) // the filter is applied asynchronously; give it a beat before reading back
      val after = toMode(manager.currentInterruptionFilter)
      if (after == mode) {
        result(true, null, before, after, "Interruptions set to $mode.", "interruption_filter")
      } else {
        result(
          false, "mismatch", before, after,
          "Zen rule was rejected ($rung1Error) and the legacy filter reported \"$after\".",
          "interruption_filter",
        )
      }
    } catch (t: Throwable) {
      result(
        false, "error", before, toMode(manager.currentInterruptionFilter),
        "Zen rule rejected: $rung1Error. Legacy filter failed: ${t.message}",
        "none",
      )
    }
  }

  /** Returns null on success, or a short failure reason. */
  private fun tryZenRule(context: Context, manager: NotificationManager, mode: String): String? {
    return try {
      val existingId = findOurRuleId(manager)

      if (mode == "off") {
        // Deactivate our rule rather than forcing the filter. Anything else the user has
        // running stays in charge, which is what makes this reversible.
        existingId?.let {
          manager.setAutomaticZenRuleState(it, Condition(CONDITION_ID, "Ally inactive", Condition.STATE_FALSE))
        }
      } else {
        val rule = buildRule(context, mode)
        val id = if (existingId != null) {
          manager.updateAutomaticZenRule(existingId, rule)
          existingId
        } else {
          manager.addAutomaticZenRule(rule)
        }
        manager.setAutomaticZenRuleState(id, Condition(CONDITION_ID, "Ally active", Condition.STATE_TRUE))
      }
      null
    } catch (t: Throwable) {
      t.message ?: "zen rule rejected"
    }
  }

  /** Diagnostics for the T3 spike and docs/DEVICE_NOTES.md. */
  fun debugState(context: Context): Map<String, Any?> {
    val manager = nm(context)
    val ourId = findOurRuleId(manager)
    return mapOf(
      "available" to isAvailable(context),
      "permissionGranted" to manager.isNotificationPolicyAccessGranted,
      "currentFilter" to manager.currentInterruptionFilter,
      "currentMode" to toMode(manager.currentInterruptionFilter),
      "ourRuleId" to ourId,
      "ourRuleCount" to (try { manager.automaticZenRules.size } catch (_: Throwable) { -1 }),
      "sdkInt" to Build.VERSION.SDK_INT,
    )
  }

  private fun result(
    ok: Boolean,
    reason: String?,
    before: String?,
    after: String?,
    message: String,
    rung: String,
  ) = mapOf(
    "ok" to ok,
    "reason" to reason,
    "before" to before,
    "after" to after,
    "message" to message,
    // Which ADR-102 rung actually did the work. Recorded so DEVICE_NOTES reflects reality.
    "rung" to rung,
  )
}
