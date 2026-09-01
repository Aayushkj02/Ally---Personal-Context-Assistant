# Device Notes

**Owner: Aayush. Append-only — never rewrite a finding, add a dated one below it.**

What the target hardware actually does, as opposed to what the documentation says it should.
The DND result below is the single most valuable fact anyone will establish this week: it decides
the most visible moment of the demo and is a P0 risk in both the PRD (§28) and SRS (§22).

## Devices

| Role | Device | Android | OEM skin | Notes |
|---|---|---|---|---|
| Primary dev/test | **Samsung SM-S928B** (Galaxy S24 Ultra) | **16 (API 36)** | One UI | Confirmed 2026-08-29 via Metro inspector |
| Demo target | iQOO *(model TBC)* | **unknown** | OriginOS / FuntouchOS | **Confirm before Phase 5** — PRD §30 open question |

> **The dev device is a Samsung, the demo device is an iQOO.** DND and brightness
> behaviour is OEM-specific, so T3/T4 results verified on One UI do **not** transfer
> to OriginOS unchanged. Every finding below must be re-run on the iQOO before the
> demo. Treat Samsung results as "works on at least one Android 16 device", not as proof.

## Build environment (2026-08-29)

| Item | Value |
|---|---|
| Java on PATH | JDK **26** — **AGP rejects this** |
| `JAVA_HOME` | JDK 17.0.19 (Microsoft) — correct, Gradle uses this |
| Fallback JDK | Android Studio JBR 21 |
| Android SDK | platforms 34 / 36 / 36.1 · build-tools 35–37 · NDK 27.1 |
| First native build | `assembleDebug` BUILD SUCCESSFUL in 5m, 427 tasks |
| Gradle cache | ~7 GB warm after first build; rebuilds are much faster |

Use `--no-daemon` for Gradle. A lingering daemon holds a lock on `android/` and makes
`expo prebuild --clean` fail with `EBUSY: resource busy or locked`.

## Expo Go is NOT a substitute for the dev build

Confirmed 2026-08-29: scanning the Metro QR with **Expo Go** (`host.exp.exponent`)
loads our JS over Wi-Fi and proves the bundle works, but it does **not** verify that
our APK (`com.ally.assistant`) installs or launches, and **Expo Go cannot load the
custom Kotlin module** added in T2. From T2 onward, Ally must run from the installed
development build or it will not start at all.

## Verified on hardware — 2026-08-29

Device `R5CY31SNAHK`, Samsung SM-S928B, Android 16, API 36, over USB adb.

| Check | Result |
|---|---|
| APK installs (`adb install -r`) | PASS |
| App launches, survives 30 s | PASS — pid stable |
| JS bundle loads | PASS — `ReactNativeJS: Running "main"` (fabric: true) |
| `ally://` deep link starts the app | PASS |
| Metro over USB (`adb reverse tcp:8081`) | PASS |
| **AllyNativeModule loads at runtime** | **PASS — UI reads `device backend: native`** |
| Reload by relaunch | PASS — force-stop, launch, fresh bundle, renders |
| **Fast Refresh** | **PASS — edited App.tsx, change appeared in the running app with no rebuild or restart** |
| `getDeviceInfo()` returns real values | PASS — manufacturer/model/API/targetSdk all correct |

**App targetSdk is 36**, so we are on **ADR-102 rung 1**: `AutomaticZenRule` is required and
legacy `setInterruptionFilter` is not available. Rung 2 (drop to targetSdk 34) remains the
escape hatch if One UI's Zen implementation does not cooperate.

### Two traps that cost time — do not repeat

**`expo-splash-screen` is required by `expo-dev-client`.** Without it the app launches to a
permanent white screen and the only clue is in logcat:
`ClassNotFoundException: expo.modules.splashscreen.SplashScreenManager` from
`DevLauncherController: Failed to hide splash screen`. It is not pulled in automatically when
Expo is added to an existing project with `expo install` (ADR-009). Installed as a dependency.

**Never `adb install -r` while the app is running.** Android kills the process, and the
teardown in logcat looks like a crash but has no FATAL or AndroidRuntime entry. Force-stop,
install, then launch — strictly in that order.

**Metro can wedge.** It stayed listening on 8081 while timing out on `/status` after having
served bundles fine. If the app hangs on load, test Metro with
`curl -m 10 http://localhost:8081/status` before debugging the app. Restart with
`npx expo start --dev-client`.

**A stale HMR connection looks exactly like broken Fast Refresh.** Fast Refresh failed twice
for us before being confirmed working. Both failures were the harness, not the product: once
against a wedged Metro, once against an app whose HMR socket had gone stale after sitting idle.
Metro logged `Android Bundled 32ms (1 module)` in every case, so *Metro rebuilding is not
evidence the device received anything*. Before concluding Fast Refresh is broken, check
`curl -s localhost:8081/json/list` — it must list `com.ally.assistant`, and if it lists
`host.exp.exponent` you are looking at Expo Go, not our build. Then relaunch the app so it
reconnects, and re-test.

**Metro wedges when `expo prebuild` runs.** Regenerating `android/` drops thousands of files
under the project root and Metro's crawler chokes: it keeps listening on 8081 and answering
`/status`, but every bundle request times out, presenting on device as a permanent white screen
that looks like an app crash. Fixed by `app/metro.config.js`, which excludes `android/` and
`ios/` from the crawler (plus `.watchmanconfig`). Bundle now serves in ~6.5 s where it
previously timed out at 90 s.

**Port 8081 must be free before starting Metro.** `npx expo start` is non-interactive here and
exits with `Input is required` rather than prompting to use another port.

> Android 15+ restricts direct global DND control for apps **targeting** API 35+. Apps targeting ≤34
> retain legacy behaviour even when running on a newer device. See ADR-102 for the ladder.

## DND / Zen — the critical spike (Phase 1, first hours)

Work down the ladder and stop at the first rung that works. Record every rung you tried, including
the ones that failed — a documented failure saves the next person two hours.

| # | Approach | Result | Notes |
|---|---|---|---|
| 1 | `AutomaticZenRule` + `ZenPolicy` via `NotificationManager`, targetSdk 36 | ❌ **REJECTED by One UI** | Three attempts, see below. Kept first in the ladder — an iQOO may accept it |
| 2 | `setInterruptionFilter()` + `ACCESS_NOTIFICATION_POLICY` | ✅ **WORKS — and at targetSdk 36** | **No need to drop to 34.** This is what ships. ADR-105 |
| 3 | `AudioManager.setRingerMode(RINGER_MODE_SILENT)` | not needed | Rung 2 was sufficient |

### Why rung 1 fails (three attempts, in order)

1. `addAutomaticZenRule()` → `"Rule must have a ConditionProviderService and/or configuration activity"`.
   Android requires every zen rule to name an owner service or a config activity.
2. Added `setConfigurationActivity(MainActivity)` → `"Lacking enabled CPS or config activity"`.
3. Discovered Expo's `android.intentFilters` **prepends `android.intent.action.`**, so our entry
   had registered as `android.intent.action.android.app.action.AUTOMATIC_ZEN_RULE_SETTINGS` — a
   valid-looking action matching nothing. Replaced it with a config plugin
   (`plugins/withZenRuleIntentFilter.js`); verified with
   `adb shell cmd package query-activities -a android.app.action.AUTOMATIC_ZEN_RULE_SETTINGS`
   that MainActivity now resolves. **The error persisted unchanged.**

One UI rejects an app-owned zen rule that satisfies the documented AOSP contract. Rung 2 works
immediately. Do not spend more time on rung 1 unless the iQOO behaves differently.

### Verified DND results — SM-S928B, Android 16, targetSdk 36

`zen_mode` read with `adb shell settings get global zen_mode` (0=off 1=priority 2=silence 3=alarms).

| Action | Reported | `zen_mode` | Rung |
|---|---|---|---|
| Priority | `Applied` off → priority | **1** | interruption_filter |
| Alarms only | `Applied` | **3** | interruption_filter |
| Silence | `Applied` | **2** | interruption_filter |
| Off | `Applied` priority → off | **0** | interruption_filter |
| Priority ×3 repeated | stable | 1, 1, 1 | idempotent |
| **Permission revoked** | `Permission needed` off → off | **0 — unchanged** | none, no write attempted |
| **Rule rejected (rung 1 era)** | `Failed`, verbatim platform reason | **0 — unchanged** | none |

DND icon appears in the status bar on activation and clears on `off`.

**Five distinct failure modes were exercised** — permission denied, missing config activity,
unresolvable action, OEM refusal, and a silent no-op — and **not one produced a partial device
mutation**. That is PRD §20 / NFR-03 demonstrated, not asserted.

### Bug this spike caught in our own code (ADR-106)

`off` did not turn DND off. Deactivating a zen rule that was never registered is a silent no-op
that throws nothing, so rung 1 "succeeded" and the ladder short-circuited before rung 2 ran. The
phone stayed in Total Silence while the app truthfully reported a mismatch. Fixed: **a rung only
counts as working if the read-back confirms the device reached the target.**

## Demo-device compatibility spike

### How to characterise any device in one tap

Install the dev build, grant DND access, tap **Run device probe**. `DndProbe.kt` (ADR-108)
reports which rung works, whether `AutomaticZenRule`/`ZenPolicy` are accepted, and whether the
priority-caller exception is expressible. It reverts everything it touches — including the
original interruption filter and notification policy — so it is safe on a phone in use.

### Probe baseline — Samsung SM-S928B, Android 16, targetSdk 36 (2026-08-29)

```
VERDICT: rung 2 (setInterruptionFilter) · priority-caller demo POSSIBLE

permissionGranted           true
currentFilter               1        (INTERRUPTION_FILTER_ALL — note: NOT the same
                                      constants as the zen_mode global setting)
zenRuleAccepted             false    "Lacking enabled CPS or config activity"
zenPolicyPreserved          false
interruptionFilterWorks     true
readPolicyWorks             true
originalPriorityCategories  96
originalCallSenders         2
priorityCallersExpressible  TRUE
callsCategoryHeld           TRUE
starredSenderScopeHeld      TRUE
priorityCallerError         null
```

### The priority-caller demo IS possible — via a different API (ADR-107)

`ZenPolicy` only attaches to an `AutomaticZenRule`, so on rung 2 it is unavailable. But
`NotificationManager.setNotificationPolicy()` with `PRIORITY_CATEGORY_CALLS` +
`PRIORITY_SENDERS_STARRED` works, verified on device. **"Let my parents call me" is achievable
on the rung we actually ship.**

Two consequences for the product:

- **"Parents" maps to starred contacts.** Android does not expose per-contact DND exceptions to
  apps, so whoever must ring through has to be starred in the device's contacts. The intent
  layer and the demo script both need to respect this.
- **Ally must snapshot and restore `NotificationManager.Policy`**, exactly as it does the
  interruption filter. The probe records `originalPriorityCategories` and `originalCallSenders`
  precisely so this is not forgotten.

### ⚠ NOT YET VERIFIED ON THE iQOO

Everything above is the **Samsung SM-S928B**. The iQOO demo device was not available
(`adb devices` showed only `R5CY31SNAHK`). Rung 1 may well work on OriginOS, which would
restore `ZenPolicy` and give a cleaner implementation for free — the ladder already tries it
first, so no code change would be needed.

**Run the probe on the iQOO before building the demo script around any of this.**

| Question | Samsung answer | iQOO |
|---|---|---|
| Which rung works? | rung 2 | ⬜ |
| `AutomaticZenRule` accepted? | no | ⬜ |
| `ZenPolicy` preserved? | no | ⬜ |
| Priority-caller expressible? | **yes**, via `NotificationManager.Policy` | ⬜ |
| Permission-denied safe? | yes, no mutation | ⬜ |


## T4 — brightness, policy restore, call safety (Samsung SM-S928B, Android 16, targetSdk 36)

### Brightness — VERIFIED

`Settings.System.SCREEN_BRIGHTNESS`, raw range 0..255 on this device, gated by `WRITE_SETTINGS`.

| Step | raw | note |
|---|---|---|
| baseline | 187 | app reports 73% |
| apply 30% | **77** | `round(30 x 255/100)` |
| restore | **187 EXACT** | percent-only path would give 186 |

**187 was chosen deliberately** — it is a value where the exact path and the percent path
disagree. At 186 both agree and the bug below would have been invisible.

**Bug caught on device (ADR-110):** a single cached raw slot was not enough. The UI
re-snapshots after every change to refresh its display, which overwrote the original before
restore could use it — restoring 73% returned 186 instead of 187. Fixed with a percent→raw map.

**Adaptive brightness** is snapshotted and restored. Without pinning to manual first, the light
sensor overwrites a manual write within moments — a change that reads back as applied and then
silently reverts.

**Limitation:** the raw cache is process-lifetime. Restoring across an app kill needs the value
persisted in `device_snapshot` (Dhrey's layer).

### Priority callers — POLICY VERIFIED, RINGING NOT VERIFIED

`NotificationManager.Policy` with `PRIORITY_CATEGORY_CALLS` + `PRIORITY_SENDERS_STARRED` +
`PRIORITY_CATEGORY_REPEAT_CALLERS`, plus `PRIORITY_CATEGORY_ALARMS` always — silencing a
context must never kill the user's alarm.

Device result: `ok: true`, `starredCallsAllowed: true`, `repeatCallersAllowed: true`,
`starredSenderScope: true`.

> **"Parents" means STARRED CONTACTS.** Android exposes no per-contact DND exception to apps.
> Whoever must ring through has to be starred in the device's contacts, or the exception will
> not fire. This is a product constraint, not an implementation detail.

**NOT VERIFIED: that the phone actually rings.** That needs a second phone placing real calls.
See the checklist below.

### Repeated-caller detection — VERIFIED (detection only)

`CallLogAnalyzer`, 4+ calls from one caller in a rolling 10-minute window from real timestamps.
Device result with `READ_CALL_LOG` granted: `ok: true`, `thresholdMet: true`, qualifying caller
correctly identified from live call history.

**This never makes anything ring** — see ADR-109. Ringing is Android's
`PRIORITY_CATEGORY_REPEAT_CALLERS` on its own 15-minute rule. Ally's 4-in-10 rule is a
*report*: "X has called 4 times in 10 minutes."

| Aspect | Rule |
|---|---|
| Threshold | >= 4 (strictly more than 3) |
| Window | rolling 10 min, from `CallLog.Calls.DATE` |
| Counted | INCOMING, MISSED, REJECTED, BLOCKED |
| Not counted | OUTGOING, VOICEMAIL |
| Identity | last 9 digits, so +91 and 0-prefixed forms match |
| Unknown/withheld | counted as `unidentifiedCalls`, **never merged** into one caller |
| No permission / query fails | `ok:false` + reason, `thresholdMet:false`, DND untouched |

### DND policy snapshot/restore

The user's `NotificationManager.Policy` is captured before the first mutation and written back
when the context ends, alongside the interruption filter. **Limitation:** process-lifetime only
— an app kill mid-context will not restore it. `dndPolicySnapshot()` exposes the serialized form
so the data layer can persist it durably in Phase 2.

### ⚠ REQUIRES A SECOND PHONE — not verifiable from this machine

These cannot be proven by API read-back and are explicitly NOT marked passing:

- [ ] Star the demo contact first, or nothing below will fire
- [ ] Start a DND context, call from the **starred** contact → phone must ring
- [ ] Call from a **non-starred** contact → must stay suppressed
- [ ] Call 4+ times in 10 min from a non-starred number → Android's repeat-caller bypass rings
- [ ] Confirm 1–3 calls do **not** trigger it
- [ ] Two callers with 2 calls each → neither qualifies, counts not merged
- [ ] End the context → original DND filter, policy and brightness all restored


## Priority channels — what Android enforces, verified against the API 36 SDK

Checked with `javap -cp android.jar 'android.app.NotificationManager$Policy'`, not assumed.

```
categories: ALARMS CALLS CONVERSATIONS EVENTS MEDIA MESSAGES REMINDERS REPEAT_CALLERS SYSTEM
senders:    ANY  CONTACTS  STARRED
ctors:      (int,int,int) (int,int,int,int) (int,int,int,int,int)
```

| Channel | Enforced? | Mechanism |
|---|---|---|
| **Calls** | **YES** | `PRIORITY_CATEGORY_CALLS` + `PRIORITY_SENDERS_STARRED` |
| **SMS** | **YES** | `PRIORITY_CATEGORY_MESSAGES` + `PRIORITY_SENDERS_STARRED` |
| **WhatsApp** | **NO — remembered only** | No public API grants another app's notifications a DND bypass |

### Enforcement states reported per channel (ADR-113)

`setPriority` returns a per-channel breakdown, not one boolean, because "we saved your setting"
and "your phone will behave differently" are different promises:

| State | Meaning |
|---|---|
| `enforced` | Applied to Android **and confirmed by reading the policy back** |
| `preference_only` | Ally remembers it; Android exposes no way to act on it. **WhatsApp, always** |
| `unsupported` | Device or API level cannot do this at all |
| `failed` | Attempted and Android did not hold the change |

`preference_only` is unreachable from a successful device call — it is hard-coded for WhatsApp,
so no code path can report a WhatsApp preference as active.
| Repeat callers | YES (Android's rule) | `PRIORITY_CATEGORY_REPEAT_CALLERS`, 15-min system window |

**Two limits the UI must state, not hide:**

1. **No per-individual-contact exception exists.** Android offers starred / all contacts /
   anyone — nothing finer. "Mom" means "a starred contact", so the demo contact must actually
   be starred or nothing fires.
2. **WhatsApp cannot be enforced.** Android 16 *does* have per-app bypass (`mAppBypassDndList`)
   and per-contact exceptions (`mExceptionContacts`) — both visible in `dumpsys notification` —
   but `javap` confirms neither is in the public SDK. So close, and unavailable.

## Emergency rule — JVM unit tests

`CallLogAnalyzer.evaluate()` is a pure function over `List<CallRecord>` and a clock, so the rule
is tested without a device or ContentResolver. `./gradlew :ally-native:testDebugUnitTest` —
**8 tests, 0 failures**:

| Test | Scenario | Expected |
|---|---|---|
| 1 | 1 call | not met |
| 2 | 3 calls in window | not met (threshold is **more than** 3) |
| 3 | 4 calls in window | **met** |
| 4 | 4 calls, oldest 11 min back | not met — it aged out |
| 5 | 2 callers x 2 calls | not met, counts never pooled |
| 6 | 4 withheld numbers | not met, never merged into one identity |
| + | qualifying caller alongside another | only the qualifying one flagged |
| + | exactly on the window edge | inclusive; 1 ms older is excluded |

Test 4 is the one that fails if anyone ever swaps the rolling window for "calls today".

**Detection and ringing stay separate (ADR-109):** Ally detects 4-in-10 and reports it. Ringing
for persistent callers is Android's own `PRIORITY_CATEGORY_REPEAT_CALLERS` on its 15-minute
rule. Emergency classification is contextual and never writes to the user's priority list.


## Priority screen — data and policy layer (Dhrey)

`priority_preference` table, migration-managed via `PRAGMA user_version`. One row per
(mode, channel, subject) with `UNIQUE(profile_id, channel, subject)`, so re-adding someone
updates rather than duplicates.

**Stored per contact, applied per scope (ADR-301).** The user names people; Android only
understands starred / all contacts / anyone. `resolvePriority()` reduces the rows to a
per-channel boolean for the device layer and returns `requiresStarring` so the screen can
tell the user exactly who to star. Without that, "why didn't Mom ring?" has no answer.

**WhatsApp shows its real state.** The screen renders `preference_only` from
`ENFORCEMENT_PRESENTATION` — "Remembered, not enforced" — never a tick.

### Demo prerequisite, worth repeating

Priority contacts on **calls** and **SMS** must be **starred in the phone's Contacts app**.
Adding them in Ally records the intent; Android will not act on it otherwise.

### Still to check before the demo

- [ ] Run `DndProbe` on the actual iQOO and fill in the column above
- [ ] Star the "parent" contact used in the demo, or the exception will not fire
- [ ] Confirm a real call from a starred contact rings through while DND is active

**Checks for whichever rung wins:**

- [ ] Status bar DND icon appears when activated, disappears when deactivated
- [ ] A call from a priority contact **rings through**
- [ ] A call from a non-priority contact is **silenced**
- [ ] A test notification is suppressed
- [ ] Deactivation returns the phone to its prior interruption state
- [ ] Behaviour is identical on the second and third activation (no drift)
- [ ] `isAvailable()` reports honestly when the rung is unsupported

**Outcome:** rung 2 (`setInterruptionFilter`) at targetSdk 36. See ADR-105 and ADR-106.

## Brightness

- [ ] `WRITE_SETTINGS` grant flow via `ACTION_MANAGE_WRITE_SETTINGS` reaches the right screen
- [ ] Set 40% → read back 40%
- [ ] Restore returns the **exact** prior value, not an approximation
- [ ] Adaptive/auto brightness does not silently override our write
- [ ] Denied permission skips brightness only; other actions still apply

**Notes:** _(OEM brightness curves are often non-linear — record the raw `Settings.System` range here)_

## Alarm

- [ ] `AlarmClock.ACTION_SET_ALARM` opens/creates without a special permission
- [ ] `EXTRA_DAYS` weekday repeat lands correctly (Mon–Fri)
- [ ] Alarm is visible in the **stock Clock app** — this is a demo money shot, film it
- [ ] Behaviour when the OEM ships a non-AOSP clock app

**Notes:**

## Speech recognition

- [ ] On-device recognition available offline
- [ ] Latency from tap to transcript
- [ ] Accuracy on the golden commands, Indian-English accents included

**Notes:**

## OEM quirks

Battery optimisation, background restrictions, aggressive task-killing, permission auto-revoke —
anything OriginOS/FuntouchOS does that AOSP does not.

| Date | Finding | Workaround |
|---|---|---|
| | | |

## Demo device checklist

Run this before the rehearsal and again before going on stage.

- [ ] All permissions pre-granted
- [ ] Onboarding already completed
- [ ] Battery optimisation disabled for Ally
- [ ] Brightness at ~80% so the drop is visible
- [ ] `adb reverse tcp:11434 tcp:11434` connected over USB
- [ ] Ollama running, model warm (send one throwaway request)
- [ ] Airplane-mode run rehearsed at least once

---

## A-V2 — exact restore across process death (2026-08-31, SM-S928B, Android 16 / API 36)

The A-V2 acceptance test. Every value below was read with `adb shell settings` / `dumpsys`,
independently of anything the app reported. The app was **force-stopped between apply and
restore**, which is the entire point: a context routinely outlives its process.

| Stage | `screen_brightness` | `screen_brightness_mode` | `zen_mode` |
|---|---|---|---|
| Before context | **187** | 0 (manual) | 0 (off) |
| Context active | 102 (40%) | 0 | 1 (priority) |
| After `am force-stop` | 102 | 0 | 1 |
| **After restore** | **187** | 0 | **0** |

**187 → 102 → process death → restore → 187.** Not 186. That single unit is the whole of
ADR-116: the contract carries brightness as a percent, 187 reports as 73%, and 73% converts
back to 186, so a percent-only restore silently loses the user's setting while every status
reads green.

Evidence the exactness is on disk and not in the heap — `shared_prefs/ally_brightness.xml`,
read from the device while the context was active:

```xml
<int name="snap_mode" value="0" />
<int name="raw_73" value="187" />   <!-- the exact value restore writes back -->
<int name="raw_40" value="102" />
```

`snap_mode` reappears after a restore because the harness immediately re-snapshots to refresh
its display, which is the next context capturing the user's mode fresh. That is intended.

**NotificationManager.Policy was byte-identical before and after:**

```
priorityCategories=PRIORITY_CATEGORY_ALARMS,PRIORITY_CATEGORY_MEDIA,
priorityCallSenders=PRIORITY_SENDERS_STARRED,priorityMessageSenders=PRIORITY_SENDERS_STARRED,
priorityConvSenders=none,mExceptionContacts=[],mAppBypassDndList=[]
```

Stated precisely: the Study `ActionPlan` changes the **zen mode** and never touches the
notification policy, so the policy is preserved because nothing modified it — not because
restore actively put it back. Policy restoration after the priority flow (`dndSetPriority`)
has a separate process-lifetime problem, recorded below.

**LIFO confirmed on device.** Captured dnd then brightness; restored brightness then dnd —
the reverse of application:

```
restore IDLE — 2/2 restored
1. brightness: restored — 40 → 73
2. dnd:        restored — priority → off
cleared: true
```

Afterwards `device_snapshot` held **0 rows** and the session was `IDLE`.

### Still process-lifetime, NOT fixed by A-V2

`DndController.savedPolicy` (the `NotificationManager.Policy` captured by the priority flow) is
still a heap field. It is not part of any `ActionPlan`, so no A-V2 path depends on it, but a
priority context that outlives its process cannot put the user's policy back. Same class of bug
as ADR-116, different capability. Fix it when priority gets a restore path.

---

## A-V7 — priority applied by the context lifecycle (2026-08-31, SM-S928B, Android 16 / API 36)

"Mom" added to **Calls only** through the Priority screen, then the real sentence run. Policy read
with `adb shell dumpsys notification`, independently of the app.

| Stage | `zen_mode` | brightness | `mConsolidatedPolicy` priorityCategories |
|---|---|---|---|
| Before | 0 | 44 | `ALARMS, MEDIA` |
| Context active | 1 | 102 | `ALARMS, CALLS, REPEAT_CALLERS` |
| After `endContext()` | 0 | **44** | `ALARMS, MEDIA` |

`CALLS` appears because Mom is a calls contact; **`MESSAGES` is correctly absent** because no SMS
contact was listed — the delta proves the policy came from the user's stored preferences and not
from a blanket "turn everything on". `REPEAT_CALLERS` is unconditional (the emergency bypass), and
`priorityCallSenders=PRIORITY_SENDERS_STARRED` is the starring requirement Android forces.

Coordinator report, alongside a `PARTIAL` plan:

```
priority calls:    enforced        — Starred contacts can call you.
priority sms:      unsupported     — Priority messages were not requested.
priority whatsapp: preference_only — Ally remembers this. Android cannot let Ally control WhatsApp notifications.
```

Also confirmed: the priority row persisted with `profileId = profile_study`, not the bare mode key.

### The notification policy restores IN-PROCESS only

Ending the context restored `ALARMS,MEDIA` because `dndApply("off")` calls `restorePolicy()`.
That path depends on `DndController.savedPolicy`, which is still a **heap field**. Observed
directly this session: a policy applied before an earlier process death was still on the device
afterwards, with no saved copy left to restore it from. Same class as ADR-116, not yet fixed for
the policy. A context whose process dies cannot put the user's notification policy back.

---

## ADR-120 — durable notification-policy restore (2026-08-31, SM-S928B, Android 16 / API 36)

### Why the process-local `savedPolicy` was not enough

Ally rewrites `NotificationManager.Policy` to express "let Mom call me", so the user's original
is borrowed state. It was held in a field on the `DndController` Kotlin object — alive exactly as
long as the process, and a context routinely outlives its process. The failure was silent rather
than loud: `restorePolicy()` read `null` and did nothing, so the phone kept Ally's policy while
every status still read green. Seen directly during A-V7, where a policy applied before an earlier
process death was still on the device with no saved copy to restore from.

### Why all five fields are preserved

Ally writes the policy through the **3-argument** `Policy` constructor, which replaces
`suppressedVisualEffects` and `priorityConversationSenders` with that constructor's defaults. Those
two are borrowed whether Ally meant to touch them or not, so a three-field restore hands back a
policy the user never had. Confirmed with `javap` against the API 36 `android.jar`: five public int
fields, three constructors, the widest taking all five.

The saved copy, read off the device mid-context:

```xml
<!-- shared_prefs/ally_dnd_policy.xml -->
<int name="priorityCategories" value="60" />
<int name="priorityCallSenders" value="2" />
<int name="priorityMessageSenders" value="2" />
<int name="suppressedVisualEffects" value="22" />
<int name="priorityConversationSenders" value="3" />
<boolean name="has_saved" value="true" />
```

### Why restoration is independent of the target mode

The restore used to live inside the `mode == "off"` branch of `dndApply`. A user who already had
Do Not Disturb on before the context got their mode back and silently kept Ally's policy — the one
case where the user had most obviously configured DND themselves. Whether a saved policy exists is
now the only condition.

### Process-death results

Both read with `adb shell dumpsys notification`, app force-stopped between apply and restore.

**Case A — DND originally off**

| Stage | zen | priorityCategories | sve | conv |
|---|---|---|---|---|
| Before | 0 | `ALARMS, MEDIA` | `SCREEN_ON,FSI,PEEK` | none |
| Active | 1 | `ALARMS, REPEAT_CALLERS` | — | — |
| force-stop (pid 1170 → 1875) | 1 | `ALARMS, REPEAT_CALLERS` | — | — |
| **After restore** | **0** | **`ALARMS, MEDIA`** | **`SCREEN_ON,FSI,PEEK`** | **none** |

**Case B — DND originally ON (`alarms_only`)** — the case the old condition failed

| Stage | zen | priorityCategories | allowPriorityChannels |
|---|---|---|---|
| Before | 3 | `ALARMS, MEDIA` | false |
| Active | 1 | `ALARMS, REPEAT_CALLERS` | true |
| force-stop (pid 2881 → 6735) | 1 | `ALARMS, REPEAT_CALLERS` | true |
| **After restore** | **3** | **`ALARMS, MEDIA`** | **false** |

The mode came back to `alarms_only`, **not** `off`, and the policy came back with it. Under the old
`mode == "off"` condition the policy restore would not have run at all here.

In both cases `ally_dnd_policy.xml` was `<map />` afterwards — cleared only once a read-back
confirmed the restore, so a failed restore keeps the original for a retry.

### Incidental fix

`describe()` was emitting Kotlin's escaped-dollar literal (`${'$'}{it.priorityCategories}`) rather
than the value, so every previous policy log line was meaningless text. Debug output only, never
behaviour. Fixed while adding the raw-int fields to `policySnapshot()`.

---

## Phase 2 gate — full vertical slice (2026-08-31, SM-S928B, Android 16 / API 36)

One sentence, the real pipeline, no fixture plan and no Study policy inside the Aayush layer:

```
"I'm going to study for two hours."
  → FallbackParser + IntentValidator (Shlok)      command_log: confidence 0.85, source fallback
  → loadProfileContext + resolve() (Dhrey)
  → buildActionPlan()                             session sess_mth4ief6_51tq2y93 / profile_study
  → startContext() (Aayush)
  → executePlan() → DND + brightness capabilities
  → SM-S928B
```

Everything below was read with `adb shell settings` / `dumpsys notification`, independently of
anything the app reported.

| Stage | brightness | mode | zen | priorityCategories |
|---|---|---|---|---|
| Before | **187** | 0 | 0 | `ALARMS, MEDIA` |
| Context active | 102 (40%) | 0 | 1 | `ALARMS, REPEAT_CALLERS` |
| After `am force-stop` (17164 → 18095) | 102 | 0 | 1 | `ALARMS, REPEAT_CALLERS` |
| **After End study** | **187** | **0** | **0** | **`ALARMS, MEDIA`** |

Afterwards: `device_snapshot` 0 rows, session `IDLE`, `ally_dnd_policy.xml` = `<map />`, UI back on
the harness with DND showing `off`. A second full cycle immediately afterwards restored identically.

### The Active Context screen across a process death

The screen reads the session from SQLite on every visit, so on the **fresh process** it still
showed `study · Active · 117:43 left` — the countdown continuing against the real `endsAt`, on a
process that had applied nothing. It reported `0/0 changes applied` and "Nothing yet" rather than
inventing results it never saw: execution results are display-only in-memory state, and the durable
truth is the session row plus the snapshots. Ending from that screen restored the device exactly.

### Execution status, as rendered

From the same run, all in one view and none of them rounded:

| Row | Shown as |
|---|---|
| dnd `off → priority` | **Applied** (green) |
| brightness `73 → 40` | **Applied** (green) |
| ringer `null → null` | **Not supported on this device** (grey — *not* red, *not* "Failed") |
| whatsapp | **Remembered, not enforced** (amber) |
| calls / sms (no contacts listed) | **Not supported on this device** — "Priority calls were not requested." |

Headline: `2/3 changes applied · session active`, state **Active**. The plan was PARTIAL in the
A-V7 run where the ringer was the only shortfall; here DND and brightness both applied and the
screen says so without claiming the ringer worked.

### Emergency detection

Run through the integrated path (`evaluateEmergency` → `describeEmergency` → Active Context), not
the old debug button. With no inbound calls in the window the screen reported:

> No caller has reached 4 calls in 10 minutes. No inbound calls.

- **Ally detection: PASS** — the real `CallLogAnalyzer` ran against the real call log and reported
  the negative case correctly, stating its own threshold and window.
- **Positive case (4+ calls): NOT TESTED on hardware.** Manufacturing four inbound calls needs a
  second handset. The rule is covered by the Kotlin JVM tests and by TypeScript integration tests
  driving the analyzer's exact payload shape.
- **Actual ringing: PLATFORM-CONTROLLED.** Android's repeat-caller bypass uses a 15-minute window
  Ally does not set. Ally detects; Android decides (ADR-109, ADR-122).

### Priority regression

Calls and SMS remain enforceable and WhatsApp remains `preference_only` — verified in the same run
(see the table above). In the A-V7 run with "Mom" on Calls only, the consolidated policy gained
`CALLS` and correctly did **not** gain `MESSAGES`. Emergency detection ran during an active context
and added nobody to Priority: `priority_preference` was unchanged and no snapshot was written.

### Build gotcha worth remembering before the demo

`expo run:android` with an emulator attached built an **x86_64-only** APK, which then failed on the
phone with `INSTALL_FAILED_NO_MATCHING_ABIS`. Kill the emulator first, or the phone silently keeps
running the previous build.

---

## Phase 3 — reversibility hardening (2026-08-31, SM-S928B, Android 16 / API 36)

Everything below was read with `adb shell settings get`, `adb shell dumpsys notification` and
`run-as cat` on the app's own `shared_prefs`. None of it is an app log.

### Who is actually holding Do Not Disturb

The most useful thing this phase turned up. `dumpsys notification` shows that our **explicit**
`AutomaticZenRule` is not registered on this device at all — rung 1 is rejected here, so rung 2
(`setInterruptionFilter`) does the work, and at targetSdk 35+ Android converts that call into an
**implicit rule of ours**:

```text
ZenRule[id=implicit_com.ally.assistant, state=STATE_TRUE, name=Do Not Disturb (Ally),
        pkg=com.ally.assistant, triggerDescription=Managed by Ally]
```

So "the filter reads priority" never told us whose rule put it there. Restore used to re-assert
the snapshotted mode, which for anything other than `off` left that implicit rule **active** —
a correct value held by the wrong owner, with the snapshots then cleared as a clean restore.

**Verified safe first:** with the user's own DND on, Ally calling `setInterruptionFilter(ALL)`
left `manualRule` at `STATE_TRUE` and `zen_mode` at `1`. It stands down Ally's rule, not theirs.

### A3.6 — the user already had Do Not Disturb on

The case Phase 2 never covered. DND turned on **by the user** first (`manualRule`,
`SOURCE_USER_ACTION`), then a full Study cycle:

| Stage | brightness | zen | Ally's implicit rule | user's manual rule |
|---|---|---|---|---|
| User's own DND on | 187 | 1 | STATE_FALSE | STATE_TRUE |
| Study active | 102 | 1 | **STATE_TRUE** | STATE_TRUE |
| **After End** | **187** | **1** | **STATE_FALSE** | **STATE_TRUE** |
| User then turns their DND off | 187 | **0** | STATE_FALSE | — |

That last row is the proof. If Ally were still holding the filter, turning off the user's own rule
would have left `zen_mode` at 1. It went to 0, so Ally was holding nothing.

### A3.7 — the Phase 2 regression, re-run after the Phase 3 changes

| Stage | brightness | zen | priorityCategories |
|---|---|---|---|
| Before | **187** | 0 | `ALARMS, MEDIA` |
| Study active | 102 | 1 | `ALARMS, REPEAT_CALLERS` |
| After force-stop (pid 24773 → 25294) | 102 | 1 | `ALARMS, REPEAT_CALLERS` |
| **After End** | **187** | **0** | **`ALARMS, MEDIA`** |

`ally_dnd_policy.xml` held all five fields across the process death, and was `<map />` afterwards.

### A3.5 — End pressed twice more with nothing running

No crash, no device change: `zen=0`, `brightness=187` after each. The app stayed alive (pid 27372).

### A bug this phase's own fix introduced, caught by reading the prefs

After a clean restore, `ally_brightness.xml` still had `borrowed=true` — the flag had re-armed one
moment after the restore cleared it, because the screen re-reads brightness to refresh its readout.
The next session would then have refused to refresh a stale raw value, reintroducing ADR-110
through the fix for ADR-116. The borrow now opens on a confirmed **write**, never a read. After the
final cycle the file is correct:

```xml
<map> <int name="snap_mode" value="0" /> <int name="raw_73" value="187" /> ... </map>
```

— no `borrowed` key, so nothing is owed.

### Not proven on this device

- **ADR-125** (a borrowed notification policy given back with no `dnd` snapshot row) is covered by
  unit tests only. Triggering it from the UI needs a context whose plan has priority but no DND
  action, and no such profile exists yet. The durable store it reads is the same one ADR-120
  already proved on this phone.
- The harness's DND readout at the top of the home screen goes **stale** — it showed
  `current: priority` while `zen_mode` was 0. A display bug in the temporary Phase 2 harness,
  which A6.6 removes; the executor and the device were both correct.

---

## Phase 4 — learned preferences on the device (2026-08-31, SM-S928B, Android 16 / API 36)

Read with `adb shell settings get`, `adb shell dumpsys notification`, `run-as cat` on the app's own
`shared_prefs`, and by pulling `ally.db` off the device and querying it directly. None of it is an
app log.

### The gate: same sentence, different phone, because Ally remembered

Three runs of the identical command, `"I'm going to study for two hours."`:

| taught preference | brightness applied | what it means |
|---|---|---|
| none | **102** (40%) | `study.json`'s default |
| brightness = 25% | **64** (25%) | the preference won |
| none (deleted again) | **102** (40%) | back to the default |

64 and 102 are what makes this a real test: 25% and 40% are visibly different raw values, so the
device itself distinguishes "the preference reached Android" from "it did not". Teaching 40% would
have looked identical either way.

The row was confirmed in the device's own SQLite before the run, not from a screen:

```json
{"capability":"brightness","value":"25","source":"user",
 "sourceCommand":"Remember that I prefer 25% brightness during study"}
```

### Restoration is unaffected by a value being learned

187 → **64** → force-stop (pid 18066 → 20032) → reopen → End → **187 exactly**, zen 0, policy back
to `ALARMS, MEDIA`. A preference the user taught Ally is still Ally's to give back.

### Provenance, on screen

The Active Context screen, mid-context, with a taught brightness and a default DND:

```text
dnd          Applied                       off → priority     from system defaults
brightness   Applied                       73 → 25            from your active profile
ringer       Not supported on this device  null → null        from system defaults
```

Two rows, one list, two different origins. That line is `PlannedAction.reason`, verbatim.

### Stored priority reaches Android

With `Mom` stored on calls and SMS for Study (both rows confirmed in `priority_preference`):

| | priorityCategories |
|---|---|
| before | `ALARMS, MEDIA` |
| Study active | `ALARMS, MESSAGES, CALLS, REPEAT_CALLERS` |
| after End | `ALARMS, MEDIA` |

`priorityCallSenders` and `priorityMessageSenders` both `PRIORITY_SENDERS_STARRED`.
`REPEAT_CALLERS` is present and was never asked for — it is Android's own safety net, and the
request type makes turning it off unrepresentable. WhatsApp stayed `Remembered, not enforced`
throughout, on both the Priority screen and the Active Context screen.

### A real failure, and what it taught us

**expo-sqlite died mid-session.** After navigating to the Priority screen and back, pressing End
produced:

```text
E ReactNativeJS: Uncaught (in promise): "Error: Call to function
'NativeDatabase.prepareAsync' has been rejected.
  → Caused by: java.lang.NullPointerException"
```

The context did NOT end. The phone stayed at 64/zen 1 with a red toast and no explanation, and
pressing End again did exactly the same thing. **Force-stopping and reopening fixed it
completely** — the fresh process restored 187, zen 0 and the original policy exactly, because
restoration only ever needed the session id.

Two separate things came out of this:

- **The root cause is upstream, in `src/memory/database/index.ts` (Dhrey's).** `getDatabase()`
  caches a module-level handle with no liveness check and no reconnect, so once the native handle
  dies every query fails until the process restarts. NOT fixed here — reported.
- **The reporting was Aayush's fault, and is fixed.** That snapshot read sits outside
  `restoreSession`'s per-row try/catch, so the rejection escaped `endContext()` entirely. It now
  comes back as PARTIAL, retryable, rows kept, with a sentence the user can act on. Deliberately
  NOT `summariseRestore([])`, which is IDLE and safe-to-clear — silently swallowing this would have
  reported the context cleanly ended and dropped the very rows the phone still needed.

### Two smaller things worth knowing before the demo

- **Taps land unreliably for a second or two after a scroll**, and immediately after a
  force-stop the JS bundle is still loading, so an early tap does nothing. Several "the button
  did not work" moments in this session were one of those two, not a bug. Wait, then tap.
- Restore correctly leaves **memories alone**: after a clean End the taught preference and the
  stored priority contacts are still in the database, while `device_snapshot` is empty and
  `ally_dnd_policy.xml` is `<map />`. Snapshots are collateral; preferences are the product.
