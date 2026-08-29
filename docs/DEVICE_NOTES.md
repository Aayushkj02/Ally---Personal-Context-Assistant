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

> Android 15+ restricts direct global DND control for apps **targeting** API 35+. Apps targeting ≤34
> retain legacy behaviour even when running on a newer device. See ADR-102 for the ladder.

## DND / Zen — the critical spike (Phase 1, first hours)

Work down the ladder and stop at the first rung that works. Record every rung you tried, including
the ones that failed — a documented failure saves the next person two hours.

| # | Approach | Result | Notes |
|---|---|---|---|
| 1 | `AutomaticZenRule` + `ZenPolicy` via `NotificationManager`, targetSdk 35+ | ⬜ untested | |
| 2 | `targetSdkVersion = 34` + `setInterruptionFilter()` + `ACCESS_NOTIFICATION_POLICY` | ⬜ untested | Escape hatch; legitimate for a sideloaded APK |
| 3 | `AudioManager.setRingerMode(RINGER_MODE_SILENT)` | ⬜ untested | Visible-effect floor only |

**Checks for whichever rung wins:**

- [ ] Status bar DND icon appears when activated, disappears when deactivated
- [ ] A call from a priority contact **rings through**
- [ ] A call from a non-priority contact is **silenced**
- [ ] A test notification is suppressed
- [ ] Deactivation returns the phone to its prior interruption state
- [ ] Behaviour is identical on the second and third activation (no drift)
- [ ] `isAvailable()` reports honestly when the rung is unsupported

**Outcome:** _(record here, then write the confirming ADR in the 1xx range)_

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
