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
