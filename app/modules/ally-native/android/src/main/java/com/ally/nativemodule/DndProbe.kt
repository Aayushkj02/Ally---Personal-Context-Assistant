package com.ally.nativemodule

import android.app.AutomaticZenRule
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.service.notification.ZenPolicy

/**
 * OWNER: Aayush. Demo-device compatibility spike.
 *
 * READ-ONLY-ISH capability probe. Answers, on ANY device in one call, the questions the demo
 * script depends on:
 *
 *   - which ADR-102 rung works
 *   - whether AutomaticZenRule is accepted
 *   - whether ZenPolicy can be attached
 *   - whether the priority-caller exception ("let my parents through") is expressible
 *
 * WHY THIS EXISTS: T3 evidence came from a Samsung SM-S928B. The demo device is an iQOO and
 * its OEM skin may behave differently — One UI already rejects a zen rule that satisfies the
 * documented AOSP contract. Rather than re-derive that by hand, this reports everything at once.
 *
 * SAFETY: every probe that mutates is reverted immediately, and the original interruption
 * filter and notification policy are restored before returning. It must be safe to run on a
 * phone someone is actually using.
 */
object DndProbe {

  private val PROBE_CONDITION: Uri = Uri.parse("condition://com.ally.assistant/probe")

  fun run(context: Context): Map<String, Any?> {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val out = LinkedHashMap<String, Any?>()

    out["manufacturer"] = Build.MANUFACTURER
    out["model"] = Build.MODEL
    out["androidRelease"] = Build.VERSION.RELEASE
    out["deviceSdk"] = Build.VERSION.SDK_INT
    out["appTargetSdk"] = context.applicationInfo.targetSdkVersion

    val granted = nm.isNotificationPolicyAccessGranted
    out["permissionGranted"] = granted
    if (!granted) {
      out["verdict"] = "GRANT DND ACCESS FIRST — probe cannot run"
      return out
    }

    val originalFilter = nm.currentInterruptionFilter
    out["currentFilter"] = originalFilter

    // ---- RUNG 1: can we register an AutomaticZenRule at all? ----
    out.putAll(probeZenRule(context, nm))

    // ---- RUNG 2: does the legacy interruption filter work? ----
    out.putAll(probeInterruptionFilter(nm, originalFilter))

    // ---- PRIORITY CALLERS: is the demo's "let my parents through" moment expressible? ----
    out.putAll(probePriorityCallers(nm))

    // Always leave the phone as we found it.
    runCatching { nm.setInterruptionFilter(originalFilter) }

    out["verdict"] = buildVerdict(out)
    return out
  }

  private fun probeZenRule(context: Context, nm: NotificationManager): Map<String, Any?> {
    val r = LinkedHashMap<String, Any?>()
    var createdId: String? = null
    try {
      val configActivity = ComponentName(context.packageName, "${'$'}{context.packageName}.MainActivity")
      val rule = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        AutomaticZenRule.Builder("Ally probe", PROBE_CONDITION)
          .setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
          .setConfigurationActivity(configActivity)
          .setZenPolicy(ZenPolicy.Builder().allowAlarms(true).allowMedia(true).build())
          .setEnabled(true)
          .build()
      } else {
        @Suppress("DEPRECATION")
        AutomaticZenRule(
          "Ally probe", null, configActivity, PROBE_CONDITION,
          ZenPolicy.Builder().allowAlarms(true).build(),
          NotificationManager.INTERRUPTION_FILTER_PRIORITY, true,
        )
      }
      createdId = nm.addAutomaticZenRule(rule)
      r["zenRuleAccepted"] = true
      r["zenRuleError"] = null

      // If the rule stuck, did ZenPolicy survive the round trip?
      val stored = nm.getAutomaticZenRule(createdId)
      r["zenPolicyPreserved"] = stored?.zenPolicy != null
    } catch (t: Throwable) {
      r["zenRuleAccepted"] = false
      r["zenRuleError"] = t.message ?: t::class.java.simpleName
      r["zenPolicyPreserved"] = false
    } finally {
      createdId?.let { runCatching { nm.removeAutomaticZenRule(it) } }
    }
    return r
  }

  private fun probeInterruptionFilter(nm: NotificationManager, original: Int): Map<String, Any?> {
    val r = LinkedHashMap<String, Any?>()
    return try {
      nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
      Thread.sleep(300)
      val reached = nm.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_PRIORITY
      nm.setInterruptionFilter(original)
      Thread.sleep(200)
      r["interruptionFilterWorks"] = reached
      r["interruptionFilterError"] = null
      r
    } catch (t: Throwable) {
      runCatching { nm.setInterruptionFilter(original) }
      r["interruptionFilterWorks"] = false
      r["interruptionFilterError"] = t.message ?: t::class.java.simpleName
      r
    }
  }

  /**
   * THE DEMO-CRITICAL ONE. "Keep me silent but let my parents through" needs
   * PRIORITY_CATEGORY_CALLS with a sender scope. On rung 2 that is expressed through
   * NotificationManager.Policy rather than ZenPolicy.
   */
  private fun probePriorityCallers(nm: NotificationManager): Map<String, Any?> {
    val r = LinkedHashMap<String, Any?>()
    val original = runCatching { nm.notificationPolicy }.getOrNull()
    r["readPolicyWorks"] = original != null
    if (original == null) {
      r["priorityCallersExpressible"] = false
      r["priorityCallerError"] = "could not read current NotificationManager.Policy"
      return r
    }

    r["originalPriorityCategories"] = original.priorityCategories
    r["originalCallSenders"] = original.priorityCallSenders

    return try {
      val probe = NotificationManager.Policy(
        NotificationManager.Policy.PRIORITY_CATEGORY_CALLS,
        NotificationManager.Policy.PRIORITY_SENDERS_STARRED,
        0,
      )
      nm.notificationPolicy = probe
      Thread.sleep(300)
      val after = nm.notificationPolicy
      val callsAllowed =
        (after.priorityCategories and NotificationManager.Policy.PRIORITY_CATEGORY_CALLS) != 0
      val starredOnly = after.priorityCallSenders == NotificationManager.Policy.PRIORITY_SENDERS_STARRED

      nm.notificationPolicy = original // restore

      r["priorityCallersExpressible"] = callsAllowed && starredOnly
      r["callsCategoryHeld"] = callsAllowed
      r["starredSenderScopeHeld"] = starredOnly
      r["priorityCallerError"] = null
      r
    } catch (t: Throwable) {
      runCatching { nm.notificationPolicy = original }
      r["priorityCallersExpressible"] = false
      r["priorityCallerError"] = t.message ?: t::class.java.simpleName
      r
    }
  }

  private fun buildVerdict(o: Map<String, Any?>): String {
    val rung1 = o["zenRuleAccepted"] == true
    val rung2 = o["interruptionFilterWorks"] == true
    val callers = o["priorityCallersExpressible"] == true
    val rung = when {
      rung1 -> "rung 1 (AutomaticZenRule)"
      rung2 -> "rung 2 (setInterruptionFilter)"
      else -> "NONE — DND unavailable"
    }
    val demo = if (callers) "priority-caller demo POSSIBLE" else "priority-caller demo NOT possible"
    return "$rung · $demo"
  }
}
