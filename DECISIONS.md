# Ally — Architecture Decision Record

Every meaningful architectural, technical or structural decision lives here. Trivial changes
(formatting, renames, obvious fixes) do **not** belong in this file.

## How to use this file

**ID ranges are partitioned by author so nobody ever renumbers anyone:**

| Range | Author |
|---|---|
| `ADR-0xx` | Joint — agreed by all three |
| `ADR-1xx` | Aayush — device, native, actions |
| `ADR-2xx` | Shlok — intent engine, Ollama, evals |
| `ADR-3xx` | Dhrey — data, policy, UI, bridge |

**This file is append-only.** Add new entries at the bottom of your own range.
Never edit or delete someone else's entry. If a decision changes, write a **new** ADR with
`Supersedes: ADR-xxx` and set the old one's status to `Superseded by ADR-yyy` — that one-line
status edit is the only permitted modification to an existing entry.

Because entries never move and IDs never collide, a merge conflict here is always resolved by
**keeping both sides**.

### Template

```markdown
### ADR-000 — Short imperative title
- **Date:** YYYY-MM-DD · **Author:** Name · **Phase:** N · **Status:** Accepted
- **Decision:** What was decided, in one or two sentences.
- **Reason:** Why this and not something else.
- **Alternatives considered:** What was evaluated and why it lost.
- **Impact:** Effect on architecture, maintainability, performance, or future work.
```

---

## ADR-0xx — Joint decisions

### ADR-001 — React Native + TypeScript + Expo Dev Build over native Kotlin
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** The app is React Native + TypeScript on an Expo Development Build. Native Android
  work is confined to one small Kotlin module (see ADR-101).
- **Reason:** Only two of the three of us write Android natively. In TypeScript all three can write
  app code simultaneously: Shlok owns the intent engine, Dhrey owns data/policy/UI, Aayush owns the
  device layer. Native Kotlin would put the entire app behind one person and make the other two
  contributors of prompts and mockups rather than code.
- **Alternatives considered:** Native Kotlin + Jetpack Compose — fastest device work, zero bridge
  friction, but a hard bottleneck on one developer. Flutter — nobody on the team has shipped it.
- **Impact:** Costs ~4–6 h of Expo dev-build setup on Day 1 and forces a rebuild for every native
  change. Accepted because JS changes hot-reload, so only Aayush ever rebuilds after the first APK.
  Confirms the stack already frozen in SRS Appendix B.

### ADR-002 — Local Ollama instead of a cloud LLM
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** Intent parsing runs against Ollama on a laptop, reached over LAN via the Ally Bridge
  `POST /parse`. No cloud provider, no API key.
- **Reason:** No API key was available, and the PRD (§21) forbids shipping secrets in the APK.
  Running the model ourselves removes the key problem entirely and gives a real privacy story:
  nothing leaves the local network. It also lets Shlok tune the prompt on the laptop **without
  rebuilding the APK**, which is a large velocity win over four days.
- **Alternatives considered:** Gemini via Firebase AI Logic — needs Firebase config in the dev build
  and an account we do not have. Direct Gemini API with an embedded key — violates PRD §21.
  On-device Gemma via MediaPipe — 1–2 days of Aayush's time and a 300 MB+ model; rejected as too
  risky, may revisit as a stretch.
- **Impact:** Introduces a LAN dependency at demo time, mitigated by ADR-003 and by using
  `adb reverse` over USB rather than venue Wi-Fi. The phone must degrade silently when the bridge is
  unreachable — every bridge call is optional by contract.

### ADR-003 — The deterministic fallback parser is mandatory, not a fallback
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** `FallbackParser` is written **before** the Ollama client and must handle 100 % of the
  golden demo commands entirely on-device with no network.
- **Reason:** ADR-002 puts a laptop and a network hop on the critical path of a live demo. The only
  acceptable answer to "what if Ollama is down on stage" is that nothing visible changes. SRS FR-06
  already requires a bounded deterministic parser; we are promoting it from insurance to a
  first-class path.
- **Alternatives considered:** Rely on Ollama alone and pre-record the demo — rejected, a live demo
  scores better and the risk is cheap to remove.
- **Impact:** Roughly 4 h of Shlok's Day 1. Buys the ability to kill Ollama on stage and keep going,
  which is itself a strong technical-depth moment. Both paths must satisfy the same eval suite.

### ADR-004 — Study and Sleep only; Focus/Work is cut
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** Ship two modes. The engine stays generic — Focus/Work is one seeded row plus one JSON
  file away — but it is not built, tested or demoed.
- **Reason:** Four days, three people. The rubric weights end-product quality at 30 % and demo at
  10 %; a third mode adds no new capability, only more surface to break. PRD §28 names "too many
  features dilute polish" as a P0 risk.
- **Alternatives considered:** All three PRD contexts — rejected on polish grounds.
- **Impact:** Reduces device testing by a third. `modes/*.json` and the policy engine must remain
  mode-agnostic so adding Focus later is data, not code.

### ADR-005 — No ambient sensor auto-detection
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** Ally acts only when told. No accelerometer/light/charging inference to propose a
  context proactively.
- **Reason:** Deliberate scope discipline — stay inside the PRD. The feature was evaluated as a
  novelty lever and consciously declined in favour of finishing the core flow well.
- **Alternatives considered:** Sensor fusion → suggestion notification, either ML-backed or
  rule-based (~0.5–1 day). Rejected.
- **Impact:** The "isn't this just Routines?" objection (PRD §28) must be answered by memory
  provenance, temporary overrides and reversibility instead. See ADR-006 and the Memory screen.

### ADR-006 — Two frozen contract boundaries: `Intent` and `ActionPlan`
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** `src/types/` is written once in Phase 0 and frozen. Shlok produces `Intent` and Dhrey
  consumes it; Dhrey produces `ActionPlan` and Aayush consumes it. Neither side reads the other's
  implementation.
- **Reason:** This is the mechanism that makes three-way parallel work possible at all. Without it
  every integration becomes a synchronous meeting.
- **Alternatives considered:** Evolve types as we go — normal practice, but in a 4-day window each
  type change is a three-way merge conflict in the most-imported file in the repo.
- **Impact:** Changing `src/types/` after Phase 0 requires all three to agree and **one** person to
  make the edit. `npx tsc --noEmit` is the gate for every phase.

### ADR-007 — `MockDevice` mirrors the native interface
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** An in-memory `DeviceRegistry` implements `DeviceCapability` identically to the Kotlin
  module and is selected automatically when the native module is absent.
- **Reason:** Shlok and Dhrey must never be blocked on the native build or on owning a physical
  device. With the mock, the whole app — policy, screens, restore, override expiry — runs anywhere.
- **Alternatives considered:** Everyone shares one test device (serialises the team); stub functions
  returning `true` (hides the permission-blocked and read-back-failure paths we specifically need to
  exercise).
- **Impact:** Parity is a standing obligation: when the native surface changes, the mock changes in
  the **same commit**. A drifted mock is worse than none. The active backend is surfaced in the UI so
  a mock is never mistaken for a real device action.

### ADR-008 — Assistant integration is app launch only
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** "Hey Gemini, open Ally" launches the app; Ally's own on-device speech handles the
  sentence. Parameterised entry comes from Android App Shortcuts and `ally://` deep links, not from
  the system assistant. AppFunctions is declared as a documented forward path only.
- **Reason:** Google deprecated App Actions / built-in intents, the `shortcuts.xml` route for
  parameterised third-party voice commands. Its successor, AppFunctions, is Android 16+ and still
  experimental/limited-access. Bixby capsules are Samsung-only and do not exist on an iQOO. Building
  the demo around "Hey Gemini, turn on Study Mode" would have failed on stage.
- **Alternatives considered:** App Actions (deprecated), Bixby capsule (wrong OEM), AppFunctions as a
  dependency (not generally available).
- **Impact:** The voice experience moves inside the app, which we control. App Shortcuts and deep
  links are offline, native and zero-risk, and the deep link doubles as the trigger surface for the
  laptop dashboard.

### ADR-009 — Bootstrap `package.json` in Phase 0; Phase 1 uses `expo install`, not `create-expo-app`
- **Date:** 2026-08-29 · **Author:** Joint · **Phase:** 0 · **Status:** Accepted
- **Decision:** Phase 0 creates a minimal `app/package.json` and `app/tsconfig.json` carrying only
  TypeScript and Prettier. Phase 1 adds Expo **into** this project with `npx expo install …`
  rather than scaffolding a new one with `npx create-expo-app`.
- **Reason:** The Phase 0 gate requires `tsc --noEmit` to pass, which needs a real TypeScript
  install. `create-expo-app` expects to scaffold into an empty directory and would clobber the
  frozen contracts, the mode files and the docs already committed here.
- **Alternatives considered:** Run `create-expo-app` in Phase 0 — pulls the whole Expo toolchain
  before we know it is needed and makes the Phase 0 diff unreviewable. Skip the type-check gate
  until Phase 1 — rejected; the contracts are the entire deliverable of Phase 0 and an
  unverified contract is not frozen, just asserted.
- **Impact:** Aayush's first Phase 1 action is `npx expo install expo expo-dev-client react
  react-native` inside `app/`, not `create-expo-app`. `tsconfig.json` is already
  strict + `jsx: react-jsx` and should be extended from `expo/tsconfig.base` rather than replaced,
  keeping `strict`, `noUncheckedIndexedAccess` and the `@/*` path alias.

---

## ADR-1xx — Aayush (device, native, actions)

### ADR-101 — One Kotlin Expo module, not four
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 0 · **Status:** Accepted
- **Decision:** All native capabilities — DND/Zen, brightness, alarm, permissions — live in a single
  `modules/ally-native` module exposing `AllyNative`.
- **Reason:** Four modules means four sets of Expo scaffolding, four rebuild paths and four files a
  teammate could touch. One module is one owner, one rebuild, and a Kotlin surface small enough to
  audit before the demo.
- **Alternatives considered:** Four capability-scoped modules as sketched in SRS §10.1 — rejected on
  setup cost alone. A config plugin per capability — more indirection, no benefit in four days.
- **Impact:** Any native change rebuilds the whole APK, but only Aayush ever rebuilds; everyone else
  hot-reloads JS. Deviates from SRS §5's four-file layout — the TypeScript-facing API in
  `src/native/` keeps the documented per-capability shape regardless.

### ADR-102 — DND fallback ladder, with `targetSdk 34` as an accepted escape hatch
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 0 · **Status:** Accepted
- **Decision:** Attempt DND in this order and stop at the first that works on the target device:
  (1) `AutomaticZenRule` + `ZenPolicy`; (2) set `targetSdkVersion = 34` and use the legacy
  `setInterruptionFilter()` + `ACCESS_NOTIFICATION_POLICY`; (3) `AudioManager.setRingerMode` as the
  visible-effect floor. Whichever wins, `isAvailable()` reports honestly.
- **Reason:** DND is the single highest-risk item in the build and the most visible one on stage.
  Android 15 restricts direct global DND control for apps **targeting** API 35+, but apps targeting
  ≤34 retain legacy behaviour even on newer devices — and a sideloaded hackathon APK has no Play
  Store targetSdk requirement. OEM skins (OriginOS/FuntouchOS) may diverge from AOSP either way.
- **Alternatives considered:** `AutomaticZenRule` only — correct but unproven on the target hardware.
  Ringer-mode only — always works, but too weak to carry the demo.
- **Impact:** Determines the demo's most visible moment. Must be spiked in the first hours of
  Phase 1; the outcome is recorded in `docs/DEVICE_NOTES.md` and confirmed in a follow-up ADR.
  Targeting 34 is a deliberate, temporary trade for demo reliability, not a shippable default.

### ADR-103 — Expo SDK 57 dev build via continuous native generation
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** Ally builds as an Expo SDK 57 development build (React Native 0.86.3,
  React 19.2.3) using continuous native generation: `android/` is produced by
  `npx expo prebuild` and stays gitignored. App id is `com.ally.assistant`, URL scheme
  is `ally`. `tsconfig.json` extends `expo/tsconfig.base` and re-asserts `strict`,
  `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noImplicitOverride`,
  `isolatedModules` and the `@/*` alias. Gradle runs against JDK 17.
- **Reason:** Implements ADR-009 — Expo was added to the existing tree with
  `npx expo install`, so the frozen contracts, mode files and docs survived untouched.
  Keeping `android/` out of git means the native project is never a merge conflict:
  it is regenerated, not reviewed. Extending the Expo base config rather than replacing
  ours is what preserves the Phase 0 type strictness that gates every phase.
- **Alternatives considered:** Committing `android/` — makes native changes reviewable
  but turns every prebuild into a large diff and guarantees conflicts on a shared file
  nobody owns. Bare React Native without Expo — loses `expo-dev-client` hot reload,
  which is the mechanism that keeps Shlok and Dhrey off the rebuild path (ADR-001).
- **Impact:** Anyone cloning the repo must run `npm install` then `npx expo prebuild
  --platform android` before their first native build; there is no checked-in Android
  project. JS changes still hot-reload with no rebuild. Two `app.json` keys were
  dropped rather than adding libraries for them: `edgeToEdgeEnabled` is no longer
  configurable now that Android 16 makes edge-to-edge mandatory, and
  `userInterfaceStyle` would have required expo-system-ui for no Phase 1 benefit.
- **Watch out:** `expo/tsconfig.base` does NOT set `isolatedModules`, so extending it
  silently dropped ours. It is re-asserted explicitly. It matters: Metro transpiles
  file-by-file, so without it TypeScript will not catch a type re-export that compiles
  fine but breaks at runtime. Verify inherited settings with `npx tsc --showConfig`
  rather than assuming.
- **Gotcha for the team:** `java` on PATH here is JDK 26, which AGP does not support.
  `JAVA_HOME` must point at JDK 17 (or the Android Studio JBR 21) or Gradle fails with
  an unhelpful error. Ours is already set correctly.
- **Open for T3:** compileSdk/targetSdk currently come from the `expo-root-project`
  plugin defaults. If the DND ladder in ADR-102 forces targetSdk 34, that is an
  `expo-build-properties` plugin entry in `app.json` — recorded in a follow-up ADR.
