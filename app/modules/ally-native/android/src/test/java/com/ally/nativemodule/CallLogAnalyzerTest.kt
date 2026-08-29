package com.ally.nativemodule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The emergency rule, tested without a device or a ContentResolver.
 *
 * Fixed clock so the rolling window is deterministic. NOW is an arbitrary epoch that
 * makes the arithmetic readable: offsets are minutes before NOW.
 */
class CallLogAnalyzerTest {

  private val now = 1_700_000_000_000L
  private fun minsAgo(m: Long) = now - m * 60_000L

  @Suppress("UNCHECKED_CAST")
  private fun callers(r: Map<String, Any?>) = r["callers"] as List<Map<String, Any?>>

  private fun countFor(r: Map<String, Any?>, id: String) =
    callers(r).firstOrNull { it["id"] == id }?.get("count") as? Int ?: 0

  /** Test 1 — a single call is never an emergency. */
  @Test
  fun oneCallDoesNotQualify() {
    val r = CallLogAnalyzer.evaluate(listOf(CallRecord("A", minsAgo(1))), now)
    assertFalse(r["thresholdMet"] as Boolean)
    assertEquals(1, countFor(r, "A"))
  }

  /** Test 2 — three calls is deliberately below the line. The threshold is MORE than 3. */
  @Test
  fun threeCallsDoNotQualify() {
    val r = CallLogAnalyzer.evaluate(
      listOf(CallRecord("A", minsAgo(1)), CallRecord("A", minsAgo(3)), CallRecord("A", minsAgo(6))),
      now,
    )
    assertFalse(r["thresholdMet"] as Boolean)
    assertEquals(3, countFor(r, "A"))
  }

  /** Test 3 — four calls inside the window trips it. 10:00, 10:02, 10:05, 10:08 seen at 10:09. */
  @Test
  fun fourCallsWithinWindowQualifies() {
    val r = CallLogAnalyzer.evaluate(
      listOf(
        CallRecord("A", minsAgo(9)),
        CallRecord("A", minsAgo(7)),
        CallRecord("A", minsAgo(4)),
        CallRecord("A", minsAgo(1)),
      ),
      now,
    )
    assertTrue(r["thresholdMet"] as Boolean)
    assertEquals(4, countFor(r, "A"))
    assertEquals(listOf("A"), r["qualifyingCallers"])
  }

  /**
   * Test 4 — the window ROLLS. Four calls exist, but the oldest is 11 minutes back and has
   * aged out, leaving three inside. This is the test that fails if someone ever swaps the
   * rolling window for "calls today" or a session counter.
   */
  @Test
  fun callsOutsideWindowAgeOut() {
    val r = CallLogAnalyzer.evaluate(
      listOf(
        CallRecord("A", minsAgo(11)),
        CallRecord("A", minsAgo(9)),
        CallRecord("A", minsAgo(6)),
        CallRecord("A", minsAgo(1)),
      ),
      now,
    )
    assertFalse(r["thresholdMet"] as Boolean)
    assertEquals(3, countFor(r, "A"))
  }

  /** Test 5 — two callers with two calls each. Counts must never be pooled. */
  @Test
  fun differentCallersAreNotCombined() {
    val r = CallLogAnalyzer.evaluate(
      listOf(
        CallRecord("A", minsAgo(1)), CallRecord("A", minsAgo(4)),
        CallRecord("B", minsAgo(2)), CallRecord("B", minsAgo(5)),
      ),
      now,
    )
    assertFalse(r["thresholdMet"] as Boolean)
    assertEquals(2, countFor(r, "A"))
    assertEquals(2, countFor(r, "B"))
  }

  /**
   * Test 6 — four withheld numbers are four different strangers, not one persistent caller.
   * Merging them would manufacture an emergency nobody triggered.
   */
  @Test
  fun unknownCallersAreNeverMerged() {
    val r = CallLogAnalyzer.evaluate(
      listOf(
        CallRecord(null, minsAgo(1)), CallRecord(null, minsAgo(3)),
        CallRecord(null, minsAgo(5)), CallRecord(null, minsAgo(7)),
      ),
      now,
    )
    assertFalse(r["thresholdMet"] as Boolean)
    assertEquals(4, r["unidentifiedCalls"])
    assertTrue(callers(r).isEmpty())
  }

  /** A qualifying caller must not drag an unrelated caller over the line with them. */
  @Test
  fun onlyTheQualifyingCallerIsFlagged() {
    val r = CallLogAnalyzer.evaluate(
      listOf(
        CallRecord("A", minsAgo(1)), CallRecord("A", minsAgo(2)),
        CallRecord("A", minsAgo(3)), CallRecord("A", minsAgo(4)),
        CallRecord("B", minsAgo(2)),
      ),
      now,
    )
    assertTrue(r["thresholdMet"] as Boolean)
    assertEquals(listOf("A"), r["qualifyingCallers"])
    assertEquals(1, countFor(r, "B"))
  }

  /** Exactly on the window edge counts; a millisecond older does not. */
  @Test
  fun windowBoundaryIsInclusive() {
    val edge = CallLogAnalyzer.evaluate(
      listOf(
        CallRecord("A", now - CallLogAnalyzer.WINDOW_MS),
        CallRecord("A", minsAgo(1)), CallRecord("A", minsAgo(2)), CallRecord("A", minsAgo(3)),
      ),
      now,
    )
    assertTrue(edge["thresholdMet"] as Boolean)

    val justOutside = CallLogAnalyzer.evaluate(
      listOf(
        CallRecord("A", now - CallLogAnalyzer.WINDOW_MS - 1),
        CallRecord("A", minsAgo(1)), CallRecord("A", minsAgo(2)), CallRecord("A", minsAgo(3)),
      ),
      now,
    )
    assertFalse(justOutside["thresholdMet"] as Boolean)
  }
}
