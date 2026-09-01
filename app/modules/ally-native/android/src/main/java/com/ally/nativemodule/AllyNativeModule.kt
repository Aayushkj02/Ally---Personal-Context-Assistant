package com.ally.nativemodule

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * OWNER: Aayush. Task T2 - the native boundary.
 *
 * ONE module for every Android capability (ADR-101). Keep this surface small and
 * auditable: it is the only code in Ally allowed to touch the device.
 *
 * Read-only and navigational surface: device info, honest permission status, and
 * opening the correct settings screen.
 *
 * Capability MUTATION lives in a controller per capability, so this file stays small
 * enough to audit before the demo:
 *   - DND (T3)        -> DndController
 *   - brightness (T4) -> not implemented yet
 *   - alarms (T5)     -> not implemented yet
 *
 * Anything not yet implemented is reported as `not_supported` by the TypeScript adapter,
 * because a truthful "not supported" beats a fake success (PRD 20, NFR-03).
 */
class AllyNativeModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AllyNative")

    /** Proves the native module is actually loaded, and tells T3 which DND rung to try. */
    Function("getDeviceInfo") {
      mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "sdkInt" to Build.VERSION.SDK_INT,
        "release" to Build.VERSION.RELEASE,
        // The app's OWN target, which is what decides whether legacy DND control is
        // still permitted - not the device's OS version. See ADR-102.
        "targetSdk" to context.applicationInfo.targetSdkVersion,
      )
    }

    /**
     * Real permission state. Never optimistic - a wrong `true` here produces exactly the
     * silent false-success the whole architecture exists to prevent.
     */
    Function("getPermissionStatus") { key: String ->
      when (key) {
        "notification_policy" -> {
          val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          nm.isNotificationPolicyAccessGranted
        }

        "write_settings" -> Settings.System.canWrite(context)

        // The permission that ACTUALLY gates what Ally does (ADR-127). This used to report
        // canScheduleExactAlarms(), which belongs to AlarmManager — an API we deliberately do not
        // use, because its alarms never reach the Clock app. Reporting it here meant the UI could
        // send the user to grant something irrelevant while the real permission stayed unchecked.
        "exact_alarm" -> AlarmController.hasPermission(context)

        // Microphone is a runtime permission handled on the JS side by expo, not here.
        else -> false
      }
    }

    /** Sends the user to the exact screen that grants the permission. */
    Function("openSettingsFor") { key: String ->
      val intent = when (key) {
        "notification_policy" ->
          Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)

        "write_settings" ->
          Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}"))

        // SET_ALARM is a normal, install-time permission: there is no settings screen that grants
        // it, so the app details page is the honest destination rather than the exact-alarm screen,
        // which would toggle something that has no effect on this capability.
        "exact_alarm" -> appDetailsIntent()

        else -> appDetailsIntent()
      }

      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    // ---- DND (T3) — see DndController for why this uses AutomaticZenRule ----

    Function("dndIsAvailable") { DndController.isAvailable(context) }

    /** Effective device-wide mode. May reflect Zen rules other than ours. */
    Function("dndGetMode") { DndController.currentMode(context) }

    /** Applies a mode and reports what the device ACTUALLY did, after a read-back. */
    Function("dndApply") { mode: String -> DndController.apply(context, mode) }

    /**
     * Restore path for the interruption filter. Stands Ally's own zen rule down first and only
     * re-asserts the mode if the device did not land there by itself (ADR-123).
     */
    Function("dndRelease") { mode: String -> DndController.release(context, mode) }

    /** Diagnostics for the T3 spike and docs/DEVICE_NOTES.md. */
    Function("dndDebugState") { DndController.debugState(context) }

    /**
     * Demo-device compatibility probe. Reports which ADR-102 rung works, whether
     * AutomaticZenRule and ZenPolicy are accepted, and whether the priority-caller
     * exception the demo depends on is expressible. Reverts everything it touches.
     */
    Function("dndProbe") { DndProbe.run(context) }

    /** Priority-caller exception + Android's own repeat-caller bypass (ADR-107). */
    Function("dndSetPriorityCallers") { allowStarred: Boolean, allowRepeatCallers: Boolean ->
      DndController.setPriorityCallers(context, allowStarred, allowRepeatCallers)
    }

    /**
     * Applies priority preferences for the channels Android enforces: calls and SMS.
     * WhatsApp is deliberately absent — no public API can enforce it (ADR-111).
     */
    Function("dndSetPriority") { allowStarred: Boolean, allowRepeatCallers: Boolean, allowMessages: Boolean ->
      DndController.setPriority(context, allowStarred, allowRepeatCallers, allowMessages)
    }

    /** The user's original notification policy, for durable persistence by the data layer. */
    Function("dndPolicySnapshot") { DndController.policySnapshot(context) }

    // Restores the user's original NotificationManager.Policy from durable storage. Driven by
    // whether a policy was saved, never by the DND mode being returned to (ADR-120).
    Function("dndRestorePolicy") { DndController.restoreSavedPolicy(context) }

    Function("dndHasSavedPolicy") { DndController.hasSavedPolicy(context) }

    // ---- Brightness (T4) ----

    Function("brightnessIsAvailable") { BrightnessController.isAvailable(context) }
    Function("brightnessSnapshot") { BrightnessController.snapshot(context) }
    Function("brightnessApply") { percent: Int -> BrightnessController.apply(context, percent) }
    Function("brightnessRestore") { percent: Int -> BrightnessController.restore(context, percent) }

    // ---- Repeated-caller DETECTION (T4). Never rings anything — see CallLogAnalyzer. ----

    // ---- Alarm (A5.1) — AlarmClock intents, so the alarm lands in the STOCK Clock app ----

    Function("alarmIsAvailable") { AlarmController.isAvailable(context) }

    /**
     * Sends a wake-up alarm to the Clock app. `weekdays` comes from the user's own words,
     * resolved upstream — nothing here infers recurrence. `sessionId` scopes idempotency.
     */
    Function("alarmSet") { hour: Int, minute: Int, weekdays: Boolean, sessionId: String ->
      AlarmController.set(context, hour, minute, weekdays, sessionId)
    }

    /** Dismisses ONLY the alarm carrying Ally's label. Unrelated alarms cannot be named. */
    Function("alarmDismiss") { sessionId: String? ->
      AlarmController.dismiss(context, sessionId)
    }

    /** Opens the Clock's own alarm list — how a human verifies what no API will report. */
    Function("alarmShowAlarms") { AlarmController.showAlarms(context) }

    Function("alarmForgetSession") { sessionId: String ->
      AlarmController.forgetSession(context, sessionId)
      true
    }

    Function("alarmDebugState") { AlarmController.debugState(context) }

    Function("callLogHasPermission") { CallLogAnalyzer.hasPermission(context) }
    Function("callLogAnalyse") { CallLogAnalyzer.analyse(context) }
  }

  private fun appDetailsIntent(): Intent =
    Intent(
      Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
      Uri.parse("package:${context.packageName}"),
    )
}
