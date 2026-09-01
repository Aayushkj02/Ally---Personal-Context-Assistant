package com.ally.nativemodule

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.provider.ContactsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

/**
 * OWNER: Aayush. The system contact picker.
 *
 * WHY A PICKER AND NOT A TEXT BOX. A priority contact used to be free text: the user typed "Mom"
 * and Ally stored the string. `PriorityPreference.subject` is documented as "the person or group as
 * the user named them", and the frozen model has no id, lookup key or number — so the picker does
 * NOT exist to store a better identity. It cannot; there is nowhere to put one.
 *
 * IT EXISTS FOR `STARRED`. Ally's DND enforcement is `PRIORITY_CATEGORY_CALLS` scoped to STARRED
 * contacts, because Android offers starred / contacts / anyone and nothing finer (ADR-111). A
 * priority contact who is not starred is therefore silenced anyway, and until now Ally could only
 * warn about that in general terms — the Priority screen says "if Mom is not starred… they will
 * still be silenced" and leaves the user to check. The picker returns a contact URI, `STARRED` is a
 * public column on it, and so Ally can finally say it about the actual person it was just handed.
 *
 * NO READ_CONTACTS, AND THAT IS THE POINT. `ACTION_PICK` runs the system's own picker in the
 * system's own process; the result Intent carries a one-time read grant for the ONE contact the
 * user chose. Ally never gains access to the address book. VERIFIED ON SM-S928B: the query below
 * succeeded with `dumpsys package com.ally.assistant` showing no contacts permission before or
 * after.
 *
 * TWO TRAPS THIS FILE EXISTS TO AVOID, BOTH HIT ON DEVICE FIRST:
 *
 *  1. `resolveActivity()` returns null at targetSdk 30+ unless the intent is declared in
 *     `<queries>`. Without that entry `isAvailable()` reported false on a phone whose picker then
 *     opened perfectly — the same package-visibility trap the manifest already documents for
 *     `AlarmController`. Hit twice now.
 *
 *  2. Raw `startActivityForResult` from `MainActivity` does not come back. The activity is
 *     `launchMode="singleTask"`, so the picker lands in its own task and BACK drops the user on
 *     their home screen instead of returning to Ally — measured, twice — leaving the promise
 *     pending forever. Expo's activity-result contract owns that plumbing, which is why this is a
 *     contract rather than a hand-rolled request code.
 */

/**
 * Input for the pick. Carries nothing, but the contract requires `Serializable` because Expo
 * persists it across a possible Activity death while the picker is in front.
 */
class ContactPickInput : Serializable

class ContactPickContract(private val context: Context) :
  AppContextActivityResultContract<ContactPickInput, Map<String, Any?>> {

  override fun createIntent(context: Context, input: ContactPickInput): Intent =
    Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI)

  /**
   * CANCELLED IS NOT AN ERROR, AND THE RESULT ALWAYS RESOLVES. Backing out of the picker is an
   * ordinary thing to do; it returns `ok: false, reason: "cancelled"` so the caller can do nothing
   * quietly. Every branch below returns a map — there is no path that leaves a promise hanging.
   */
  override fun parseResult(
    input: ContactPickInput,
    resultCode: Int,
    intent: Intent?,
  ): Map<String, Any?> {
    if (resultCode != Activity.RESULT_OK || intent?.data == null) {
      return mapOf("ok" to false, "reason" to "cancelled")
    }

    return try {
      context.contentResolver
        .query(
          intent.data!!,
          arrayOf(
            ContactsContract.Contacts.DISPLAY_NAME,
            ContactsContract.Contacts.LOOKUP_KEY,
            ContactsContract.Contacts.STARRED,
          ),
          null,
          null,
          null,
        )
        .use { cursor ->
          if (cursor == null || !cursor.moveToFirst()) {
            return mapOf("ok" to false, "reason" to "unreadable")
          }
          val name = cursor.getString(0)?.trim().orEmpty()
          if (name.isEmpty()) {
            // A contact with no display name would be stored as an empty subject and render as a
            // blank row the user cannot identify or remove with confidence.
            return mapOf("ok" to false, "reason" to "no_name")
          }
          mapOf(
            "ok" to true,
            "displayName" to name,
            "lookupKey" to (cursor.getString(1) ?: ""),
            // Read, reported, and deliberately NOT persisted: starring is changed in Contacts at
            // any time, so a stored copy would go stale and start lying. Ally asks each time.
            "starred" to (cursor.getInt(2) == 1),
          )
        }
    } catch (e: SecurityException) {
      // The one-time URI grant did not cover the read. If this ever fires, the permission-free
      // route is gone and the honest answer is to say so rather than ask for READ_CONTACTS.
      mapOf("ok" to false, "reason" to "security")
    } catch (e: Exception) {
      mapOf("ok" to false, "reason" to "error")
    }
  }
}

object ContactPicker {
  /** Does anything on this phone answer the pick intent? Needs the `<queries>` entry to be true. */
  fun isAvailable(context: Context): Boolean =
    Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI)
      .resolveActivity(context.packageManager) != null
}
