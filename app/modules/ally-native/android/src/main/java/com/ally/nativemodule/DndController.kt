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

  /**
   * The user's NotificationManager.Policy as it was before Ally first touched it.
   *
   * Ally mutates this to express the priority-caller exception, so it is user state we
   * borrowed and must give back — exactly like the interruption filter. Captured once, on the
   * first mutation, and written back when the context ends.
   *
   * LIMITATION: this lives for the process only. If Ally is killed mid-context the policy is
   * not restored on next launch. Durable snapshots belong in Dhrey's device_snapshot table;
   * `policySnapshot()` exposes the serialized form so that can be wired up in Phase 2.
   */
  private var savedPolicy: NotificationManager.Policy? = null

  private fun rememberPolicy(manager: NotificationManager) {
    if (savedPolicy == null) {
      savedPolicy = runCatching { manager.notificationPolicy }.getOrNull()
    }
  }

  private fun describe(p: NotificationManager.Policy?): String? = p?.let {
    "cat=${'$'}{it.priorityCategories},calls=${'$'}{it.priorityCallSenders},msgs=${'$'}{it.priorityMessageSenders}"
  }

  /** Serialized original policy, for durable persistence by the data layer later. */
  fun policySnapshot(context: Context): Map<String, Any?> {
    val manager = nm(context)
    val current = runCatching { manager.notificationPolicy }.getOrNull()
    return mapOf(
      "saved" to describe(savedPolicy),
      "current" to describe(current),
      "hasSaved" to (savedPolicy != null),
    )
  }

  /**
   * Expresses "let my parents call me" using the mechanism that works on the rung we ship.
   *
   * ZenPolicy is a rung-1 feature and unavailable to us (ADR-105), so the exception goes
   * through NotificationManager.Policy: PRIORITY_CATEGORY_CALLS scoped to starred contacts,
   * plus PRIORITY_CATEGORY_REPEAT_CALLERS which is Android's own persistent-caller safety net.
   *
   * "Parents" therefore means STARRED CONTACTS — Android exposes no per-contact DND exception
   * to apps. See ADR-107.
   */
  fun setPriorityCallers(context: Context, allowStarred: Boolean, allowRepeatCallers: Boolean): Map<String, Any?> =
    setPriority(context, allowStarred, allowRepeatCallers, allowMessages = false)

  /**
   * Applies the user's priority preferences for the channels Android can actually enforce.
   *
   * ENFORCEABLE: calls (PRIORITY_CATEGORY_CALLS) and SMS (PRIORITY_CATEGORY_MESSAGES), each
   * scoped to starred contacts. Confirmed against the API 36 SDK.
   *
   * NOT ENFORCEABLE: WhatsApp, or any other app's notifications. No public API lets one app
   * grant another app's notifications a DND bypass. Android 16 has per-app bypass internally
   * (`mAppBypassDndList`) but it is absent from the public SDK — verified with javap. WhatsApp
   * preferences are remembered by Ally and must be shown as such (ADR-111).
   *
   * There is also no per-INDIVIDUAL-contact exception: Android offers starred / contacts /
   * anyone, nothing finer. "Mom" therefore means "a starred contact".
   */
  fun setPriority(
    context: Context,
    allowStarred: Boolean,
    allowRepeatCallers: Boolean,
    allowMessages: Boolean,
  ): Map<String, Any?> {
    val manager = nm(context)
    if (!manager.isNotificationPolicyAccessGranted) {
      return mapOf(
        "ok" to false, "reason" to "permission",
        "message" to "Do Not Disturb access is needed before Ally can change this.",
        "channels" to listOf("calls", "sms").map {
          mapOf("channel" to it, "status" to "failed",
            "message" to "Do Not Disturb access is needed before Ally can change this.")
        } + listOf(
          mapOf("channel" to "whatsapp", "status" to "preference_only",
            "message" to "Ally remembers this. Android cannot let Ally control WhatsApp notifications."),
        ),
      )
    }
    rememberPolicy(manager)
    return try {
      var categories = 0
      if (allowStarred) categories = categories or NotificationManager.Policy.PRIORITY_CATEGORY_CALLS
      if (allowRepeatCallers) categories = categories or NotificationManager.Policy.PRIORITY_CATEGORY_REPEAT_CALLERS
      if (allowMessages) categories = categories or NotificationManager.Policy.PRIORITY_CATEGORY_MESSAGES
      // Alarms stay allowed — silencing a context must never kill the user's alarm.
      categories = categories or NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS

      manager.notificationPolicy = NotificationManager.Policy(
        categories,
        if (allowStarred) NotificationManager.Policy.PRIORITY_SENDERS_STARRED else 0,
        if (allowMessages) NotificationManager.Policy.PRIORITY_SENDERS_STARRED else 0,
      )
      Thread.sleep(250)

      val after = manager.notificationPolicy
      val callsHeld = !allowStarred ||
        (after.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_CALLS) != 0
      val repeatHeld = !allowRepeatCallers ||
        (after.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_REPEAT_CALLERS) != 0
      val starredHeld = !allowStarred ||
        after.priorityCallSenders == NotificationManager.Policy.PRIORITY_SENDERS_STARRED
      val messagesHeld = !allowMessages ||
        ((after.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_MESSAGES) != 0 &&
          after.priorityMessageSenders == NotificationManager.Policy.PRIORITY_SENDERS_STARRED)

      val ok = callsHeld && repeatHeld && starredHeld && messagesHeld

      // Per-channel outcome. "Saved your setting" and "your phone will behave differently"
      // are different promises and are reported as such (ADR-113).
      val channels = listOf(
        mapOf(
          "channel" to "calls",
          "status" to when {
            !allowStarred -> "unsupported"
            callsHeld && starredHeld -> "enforced"
            else -> "failed"
          },
          "message" to when {
            !allowStarred -> "Priority calls were not requested."
            callsHeld && starredHeld -> "Starred contacts can call you."
            else -> "Android did not hold the priority-call policy."
          },
        ),
        mapOf(
          "channel" to "sms",
          "status" to when {
            !allowMessages -> "unsupported"
            messagesHeld -> "enforced"
            else -> "failed"
          },
          "message" to when {
            !allowMessages -> "Priority messages were not requested."
            messagesHeld -> "Starred contacts can message you."
            else -> "Android did not hold the priority-message policy."
          },
        ),
        mapOf(
          // Always preference_only. Android exposes no per-app DND bypass publicly, so this
          // is never sent to the device and must never be reported as enforced (ADR-111).
          "channel" to "whatsapp",
          "status" to "preference_only",
          "message" to "Ally remembers this. Android cannot let Ally control WhatsApp notifications.",
        ),
      )

      mapOf(
        "channels" to channels,
        "ok" to ok,
        "reason" to if (ok) null else "mismatch",
        "starredCallsAllowed" to callsHeld,
        "repeatCallersAllowed" to repeatHeld,
        "starredSenderScope" to starredHeld,
        "starredMessagesAllowed" to messagesHeld,
        // WhatsApp is remembered by Ally, never enforced here. Stated so callers cannot
        // mistake the absence of an error for enforcement.
        "whatsappEnforceable" to false,
        "savedOriginal" to describe(savedPolicy),
        "message" to if (ok) {
          "Starred contacts" + (if (allowMessages) " (calls and messages)" else " (calls)") +
            " and repeat callers can reach you."
        } else {
          "Android did not hold the requested priority policy."
        },
      )
    } catch (t: Throwable) {
      mapOf("ok" to false, "reason" to "error", "message" to (t.message ?: "Priority caller change failed."))
    }
  }

  /** Puts the user's original notification policy back. Called when a context ends. */
  private fun restorePolicy(manager: NotificationManager) {
    savedPolicy?.let {
      runCatching { manager.notificationPolicy = it }
      savedPolicy = null
    }
  }

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
        // Ending the context gives back BOTH pieces of borrowed state: the interruption
        // filter and the notification policy we changed to express priority callers.
        restorePolicy(manager)
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
