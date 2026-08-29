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
/**
 * One inbound call attempt, stripped of ContentResolver so the rule can be tested on the JVM.
 * `callerId` is null when the number was withheld/unknown.
 */
data class CallRecord(val callerId: String?, val timestampMs: Long, val displayName: String? = null)

object CallLogAnalyzer {

  const val THRESHOLD = 4
  const val WINDOW_MS = 10 * 60 * 1000L

  /**
   * THE RULE, as a pure function. No Android dependency, so Tests 1-6 run on the JVM.
   *
   * 4 or more calls from the SAME caller inside a rolling window ending at `nowMs`.
   * Records outside the window are dropped, so old calls age out rather than counting forever.
   * Withheld callers are counted but never merged into one identity.
   */
  fun evaluate(records: List<CallRecord>, nowMs: Long): Map<String, Any?> {
    val since = nowMs - WINDOW_MS
    val inWindow = records.filter { it.timestampMs >= since && it.timestampMs <= nowMs }

    val counts = LinkedHashMap<String, Int>()
    val names = LinkedHashMap<String, String?>()
    var unidentified = 0

    for (r in inWindow) {
      val id = r.callerId
      if (id.isNullOrBlank()) {
        unidentified++
        continue
      }
      counts[id] = (counts[id] ?: 0) + 1
      if (r.displayName != null) names[id] = r.displayName
    }

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

    return mapOf(
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
  }

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
    val records = ArrayList<CallRecord>()

    return try {
      context.contentResolver.query(
        CallLog.Calls.CONTENT_URI,
        arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.TYPE, CallLog.Calls.CACHED_NAME),
        "${CallLog.Calls.DATE} >= ?",
        arrayOf(since.toString()),
        "${CallLog.Calls.DATE} DESC",
      )?.use { c ->
        val numIdx = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
        val dateIdx = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
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
          // Withheld / unknown / payphone. Passed through as null so evaluate() counts
          // them as unidentified rather than merging them into a single caller.
          val id = if (raw.isEmpty() || raw == "-1" || raw == "-2" || raw == "-3") null else normalise(raw)
          records.add(CallRecord(id, c.getLong(dateIdx), c.getString(nameIdx)))
        }
      } ?: return mapOf(
        "ok" to false,
        "reason" to "error",
        "message" to "Call log query returned nothing to read.",
        "thresholdMet" to false,
        "callers" to emptyList<Map<String, Any?>>(),
      )

      evaluate(records, nowMs)
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
