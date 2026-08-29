package com.ally.nativemodule

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog

/**
 * OWNER: Aayush. Task T4 — repeated-caller detection.
 *
 * WHAT THIS IS NOT: this does not make anything ring. Android does not let an app un-suppress
 * a specific incoming call — DND is evaluated by the system, in advance, against policy. The
 * actual ring-through for persistent callers is Android's own
 * PRIORITY_CATEGORY_REPEAT_CALLERS, enabled by DndController. See ADR-109.
 *
 * WHAT THIS IS: an honest read of the call log that answers "has this person been trying to
 * reach me?" so Ally can SURFACE it — in the result card, the audit log, and later a
 * notification. Detection and reporting only.
 *
 * THE RULE: 4 or more calls from the SAME caller within a rolling 10-minute window ending now.
 * Strictly more than 3. The window is computed from real call timestamps, so calls age out.
 *
 * FAILS CONSERVATIVELY: without READ_CALL_LOG, or if the query fails, it reports that plainly.
 * It never guesses, never fabricates a count, and never touches DND policy.
 */
object CallLogAnalyzer {

  const val THRESHOLD = 4
  const val WINDOW_MS = 10 * 60 * 1000L

  fun hasPermission(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) ==
      PackageManager.PERMISSION_GRANTED

  /**
   * Counts inbound call attempts per caller inside the rolling window.
   *
   * Counted types: INCOMING, MISSED, REJECTED, BLOCKED — every one of them is someone
   * trying to reach you, which is the question being asked. OUTGOING and VOICEMAIL are not.
   *
   * Unknown/withheld numbers are deliberately NOT grouped: two different withheld callers
   * are not one persistent caller, and treating them as one would manufacture an emergency
   * that nobody triggered. They are counted separately and reported as unidentified.
   */
  fun analyse(context: Context, nowMs: Long = System.currentTimeMillis()): Map<String, Any?> {
    if (!hasPermission(context)) {
      return mapOf(
        "ok" to false,
        "reason" to "permission",
        "message" to "Call log access is needed to detect repeated callers.",
        "thresholdMet" to false,
        "callers" to emptyList<Map<String, Any?>>(),
      )
    }

    val since = nowMs - WINDOW_MS
    val counts = LinkedHashMap<String, Int>()
    val names = LinkedHashMap<String, String?>()
    var unidentified = 0

    return try {
      context.contentResolver.query(
        CallLog.Calls.CONTENT_URI,
        arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.TYPE, CallLog.Calls.CACHED_NAME),
        "${CallLog.Calls.DATE} >= ?",
        arrayOf(since.toString()),
        "${CallLog.Calls.DATE} DESC",
      )?.use { c ->
        val numIdx = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
        val typeIdx = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
        val nameIdx = c.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)

        while (c.moveToNext()) {
          val type = c.getInt(typeIdx)
          val inbound = type == CallLog.Calls.INCOMING_TYPE ||
            type == CallLog.Calls.MISSED_TYPE ||
            type == CallLog.Calls.REJECTED_TYPE ||
            type == CallLog.Calls.BLOCKED_TYPE
          if (!inbound) continue

          val raw = c.getString(numIdx)?.trim().orEmpty()
          if (raw.isEmpty() || raw == "-1" || raw == "-2" || raw == "-3") {
            // Withheld / unknown / payphone. Never merged into a single identity.
            unidentified++
            continue
          }
          val key = normalise(raw)
          counts[key] = (counts[key] ?: 0) + 1
          if (c.getString(nameIdx) != null) names[key] = c.getString(nameIdx)
        }
      } ?: return mapOf(
        "ok" to false,
        "reason" to "error",
        "message" to "Call log query returned nothing to read.",
        "thresholdMet" to false,
        "callers" to emptyList<Map<String, Any?>>(),
      )

      val callers = counts.entries
        .sortedByDescending { it.value }
        .map {
          mapOf(
            "id" to it.key,
            "name" to names[it.key],
            "count" to it.value,
            "qualifies" to (it.value >= THRESHOLD),
          )
        }

      mapOf(
        "ok" to true,
        "reason" to null,
        "thresholdMet" to callers.any { it["qualifies"] == true },
        "qualifyingCallers" to callers.filter { it["qualifies"] == true }.map { it["id"] },
        "callers" to callers,
        "unidentifiedCalls" to unidentified,
        "windowMinutes" to (WINDOW_MS / 60000),
        "threshold" to THRESHOLD,
        "message" to buildMessage(callers, unidentified),
      )
    } catch (t: Throwable) {
      mapOf(
        "ok" to false,
        "reason" to "error",
        "message" to (t.message ?: "Could not read the call log."),
        "thresholdMet" to false,
        "callers" to emptyList<Map<String, Any?>>(),
      )
    }
  }


  /** Last 9 digits, so +91 98765 43210 and 098765 43210 are one person rather than two. */
  private fun normalise(number: String): String {
    val digits = number.filter { it.isDigit() }
    return if (digits.length > 9) digits.takeLast(9) else digits
  }

  private fun buildMessage(callers: List<Map<String, Any?>>, unidentified: Int): String {
    val qualifying = callers.filter { it["qualifies"] == true }
    if (qualifying.isEmpty()) {
      val top = callers.maxByOrNull { it["count"] as Int }
      val detail = top?.let { "Most persistent: ${it["name"] ?: it["id"]} (${it["count"]})." } ?: "No inbound calls."
      return "No caller has reached $THRESHOLD calls in 10 minutes. $detail" +
        if (unidentified > 0) " $unidentified call(s) from withheld numbers were not attributed." else ""
    }
    val first = qualifying.first()
    return "${first["name"] ?: first["id"]} has called ${first["count"]} times in 10 minutes."
  }
}
