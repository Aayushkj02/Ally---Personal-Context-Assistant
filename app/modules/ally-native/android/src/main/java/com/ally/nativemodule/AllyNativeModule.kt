package com.ally.nativemodule

import android.app.AlarmManager
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
 * T2 deliberately implements only what is READ-ONLY or navigational:
 *   - device info, so JS can prove the native backend is really live
 *   - honest permission status
 *   - opening the correct settings screen
 *
 * Capability MUTATION (DND in T3, brightness in T4, alarms in T5) is not here yet.
 * The TypeScript adapter reports those as `not_supported` until they land, because a
 * truthful "not supported" beats a fake success (PRD 20, NFR-03).
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

        "exact_alarm" -> {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.canScheduleExactAlarms()
          } else {
            true
          }
        }

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

        "exact_alarm" ->
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
          } else {
            appDetailsIntent()
          }

        else -> appDetailsIntent()
      }

      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }
  }

  private fun appDetailsIntent(): Intent =
    Intent(
      Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
      Uri.parse("package:${context.packageName}"),
    )
}
