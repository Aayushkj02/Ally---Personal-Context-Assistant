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

## ADR-2xx — Shlok (intent engine, Ollama, evals)

### ADR-201 — FallbackParser-first: Ollama is an enhancement, not a dependency
- **Date:** 2026-08-30 · **Author:** Shlok · **Phase:** 2 · **Status:** Accepted
- **Decision:** `DefaultIntentEngine` always attempts Ollama first with a hard 2.5 s timeout, but
  the deterministic `FallbackParser` must handle every golden command entirely on-device with no
  network. Ollama's presence upgrades quality; its absence changes only the `source` chip.
- **Reason:** ADR-002 and ADR-003 established this contract in Phase 0. Phase 2 confirms it: the
  fallback parser achieves 98% accuracy on the 50-case eval dataset without any network call.
  The Ollama path is tested via mocks so it never blocks CI and never requires a live LAN connection.
- **Alternatives considered:** Require Ollama for full functionality — introduces a demo-time single
  point of failure and violates SRS FR-06. Gate the eval on Ollama — untestable in CI and masks
  fallback regressions.
- **Impact:** The eval suite runs 100% offline. Both paths share the same `IntentValidator` boundary
  so Ollama output is never trusted more than fallback output.

### ADR-202 — Channel intent encoded in `IntentException.channel`, not a new top-level field
- **Date:** 2026-08-30 · **Author:** Shlok · **Phase:** 2 · **Status:** Accepted
- **Decision:** The channel (calls / sms / whatsapp) on a priority exception is carried in the
  optional `channel` field added to `IntentException` (Phase 2 contract update, agreed by all three).
  The `Intent` struct itself gains no new top-level field.
- **Reason:** Channel is a property of *who can interrupt* (the exception), not of *what the user is
  doing* (the activity). Putting it on the exception is semantically correct and keeps the `Intent`
  struct minimal. The field is optional and backward-compatible: absent means 'calls', which is what
  every pre-Phase-2 command meant.
- **Alternatives considered:** Add `channel` to `Intent` directly — wrong semantics; an intent can
  have multiple exceptions with different channels. Encode channel in `IntentException.value` as a
  prefix — brittle, requires callers to parse strings.
- **Impact:** `IntentValidator` passes the channel through when it is a known `CHANNELS` value and
  drops it silently otherwise, preserving the security boundary. Parsers set it; policy and execution
  layers read it; no parser reads another parser's output.

### ADR-203 — WhatsApp exceptions are always `preference_only`; parser signals this via `requiresConfirmation`
- **Date:** 2026-08-30 · **Author:** Shlok · **Phase:** 2 · **Status:** Accepted
- **Decision:** When the user names WhatsApp as a channel, `FallbackParser` sets
  `requiresConfirmation: true` on the intent. No capability value of `'whatsapp'` is produced.
  The intent correctly records the user's preference; Dhrey's policy layer and Aayush's execution
  layer handle the distinction between enforceable and preference-only channels via
  `CHANNEL_ENFORCEABLE` (capability.ts).
- **Reason:** The platform has no public API that lets one app grant another app's notifications a
  DND bypass (ADR-113 establishes this for the device layer). The AI must not produce an intent
  that implies WhatsApp is enforceable — doing so would cause downstream code to attempt an API
  call that either silently fails or never exists, and the user would be told their preference is
  active when it is not (violates PRD §20, NFR-03: never fake success).
- **Alternatives considered:** Return a clarification instead — loses the preference entirely; the
  user asked for something valid. Add a `preference_only` flag to `Intent` — over-engineering;
  `requiresConfirmation` already signals "do not execute blindly", and the channel field tells
  policy why. Silently drop the WhatsApp exception — worst option; no record of the preference.
- **Impact:** Any intent with a WhatsApp exception reaches the policy layer with
  `requiresConfirmation: true`. Policy must prompt the user or surface `preference_only` status
  before acting. The intent is recorded in the command log so the Memory screen can show provenance.

### ADR-204 — Teaching, query, and correction intent representation with source sentence preservation
- **Date:** 2026-08-31 · **Author:** Shlok · **Phase:** 4 · **Status:** Accepted
- **Decision:** Phase 4 memory, teaching, and query commands are represented within the frozen `Intent`
  contract without adding new fields. Teaching commands ("Remember that...", "Learn that...", "Always let...")
  produce `operation: 'teach'` and `persistence: 'persistent'`. Memory query commands ("What do you remember...",
  "Why do you let...", "When did I teach...") produce `operation: 'query'` with no device changes (`requestedChanges: []`).
  Preference corrections and removals ("Actually, don't let...", "Remove Mom from...") emit `effect: 'block'` on
  the targeted exception. `rawText` always retains the exact verbatim user sentence for the Memory screen's provenance.
- **Reason:** The frozen `Intent` contract (src/types/intent.ts) already contains the complete expressive surface
  needed (`operation`, `persistence`, `exceptions[].effect`, `rawText`). Adding separate memory types would cross
  contract boundaries and break parallel workflows. Storing the exact user sentence in `rawText` directly fulfills
  Phase 4's primary product gate ("a preference Ally learns can be traced back to the sentence that taught it")
  without lossy LLM summarization.
- **Alternatives considered:** Synthesize AI summaries for memory storage — rejected; destroys audit provenance
  and violates the Phase 4 gate. Have AI query the SQLite database directly — rejected; violates module ownership
  (Dhrey owns database storage/retrieval).
- **Impact:** Dhrey's memory layer receives unambiguous `teach`, `query`, and `modify` intents with full channel
  and exception scoping. The provenance chain is 100% faithful to the user's spoken words.

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

### ADR-104 — Unimplemented capabilities report `not_supported`, never silently succeed
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** The native backend ships every capability from day one via
  `pendingCapability()`: real permission reporting, `isAvailable() === false`, and
  `not_supported` from `execute`/`restore` until the real implementation lands
  (DND in T3, brightness in T4, alarms in T5). Permission metadata moved out of
  `MockDevice.ts` into `src/native/permissions.ts`, shared by both backends.
- **Reason:** The alternative — omitting capabilities until they are built — means the
  registry is incomplete, `device.get('dnd')` can return undefined, and every consumer
  needs a null check that disappears later. Worse, it delays the honest-failure path to
  the end of the project when it is the single most load-bearing behaviour we have
  (PRD 20, NFR-03). Shipping the truthful negative first means Dhrey's policy engine
  and the action executor can be exercised end-to-end against a native backend before
  a single device API is called, and the UI renders a real `not_supported` chip today.
- **Alternatives considered:** Throw from unimplemented capabilities — turns a normal
  product state into an exception and tempts a try/catch that swallows real failures.
  Return `failed` — inaccurate; nothing was attempted, so nothing failed. Leave the
  capability out of the registry — pushes an undefined check into every consumer.
- **Impact:** `device.backend === 'native'` no longer implies every capability works,
  so `isAvailable()` is the authority, not the backend name. Sharing the permission
  labels removes the copy that would otherwise drift and makes the ADR-007 parity
  obligation cheaper to keep. T3/T4 replace one entry in `createNativeCapabilities()`
  at a time with no change to any caller.

### ADR-105 — DND ships on ADR-102 rung 2; `AutomaticZenRule` is unusable on One UI
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** `DndController` implements the ADR-102 ladder in code and falls through
  automatically. Rung 1 (`AutomaticZenRule`) is attempted first and rung 2 (legacy
  `NotificationManager.setInterruptionFilter`) does the work in practice. Every result
  reports which rung ran via a `rung` field that reaches the UI. **`targetSdk` stays at 36** —
  we did NOT need to drop to 34.
- **Reason:** Three genuine attempts at rung 1 all failed on the Samsung SM-S928B (One UI,
  Android 16). `addAutomaticZenRule()` first threw *"Rule must have a ConditionProviderService
  and/or configuration activity"*; adding `setConfigurationActivity(MainActivity)` changed it to
  *"Lacking enabled CPS or config activity"*; and that persisted even after MainActivity was
  verified to resolve for `android.app.action.AUTOMATIC_ZEN_RULE_SETTINGS` via
  `cmd package query-activities`. One UI rejects an app-owned zen rule that satisfies the
  documented AOSP contract. Rung 2 works, immediately and repeatably.
- **Alternatives considered:** Keep fighting rung 1 — unbounded time against an OEM behaviour
  we cannot see the source of, on the highest-risk item in the project. Drop to `targetSdk 34`
  as ADR-102 anticipated — turned out to be unnecessary, and would have been a real cost
  (it constrains every other Android API we touch for the rest of the build).
- **Impact:** **This removes a planned risk rather than adding one.** ADR-102 assumed rung 2
  would require `targetSdk 34`; on this device the legacy call is honoured at 36, so the app
  keeps a modern target. Rung 1 stays first in the ladder, so a device that supports it
  (an iQOO may) gets the better implementation with no code change. `ZenPolicy` (the
  priority-caller exception the demo needs) is only expressible on rung 1 — on rung 2 the
  device's own priority-caller configuration applies, which must be checked before the demo.
- **Supersedes nothing.** ADR-102's ladder stands; this records which rung reality selected.

### ADR-106 — A capability rung only counts as working if the read-back confirms it
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** In a fallback ladder, "the call did not throw" is NOT success. A rung is only
  accepted when the post-write read-back shows the device actually reached the target state;
  otherwise we fall through to the next rung.
- **Reason:** Found on device. Turning DND off with no zen rule registered made rung 1
  deactivate a rule that never existed — a silent no-op that threw nothing, so the ladder
  short-circuited and rung 2 never ran. The phone stayed in Total Silence while the app
  correctly reported a mismatch. The report was truthful but the device was in the wrong
  state, which is a worse failure than an honest error: the user asked for silence to end.
- **Alternatives considered:** Special-case `off` to always use rung 2 — fixes this instance
  and leaves the same trap for every future capability. Treat a no-op as failure at the rung
  level — conflates "did nothing because nothing was needed" with "could not act".
- **Impact:** Generalises to T4 (brightness) and T5 (alarms): read-back is what decides
  success, not the absence of an exception. This is the same rule as PRD 20 / NFR-03 applied
  one level down, to rung selection rather than to user-facing status.

### ADR-107 — Priority-caller exception via `NotificationManager.Policy`, not `ZenPolicy`
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** The demo's "keep me silent but let my parents through" moment is expressed with
  `NotificationManager.setNotificationPolicy()` — `PRIORITY_CATEGORY_CALLS` plus a sender scope
  such as `PRIORITY_SENDERS_STARRED` — and NOT with `ZenPolicy`.
- **Reason:** ADR-105 established that we run on rung 2 because One UI rejects our
  `AutomaticZenRule`. `ZenPolicy` only attaches to a zen rule, so on rung 2 it is simply not
  available — which left the single most visceral moment in the demo unverified. A capability
  probe on the SM-S928B shows the legacy policy API does the job: `priorityCallersExpressible`,
  `callsCategoryHeld` and `starredSenderScopeHeld` all true, no error. The exception is
  expressible on the rung we actually ship.
- **Alternatives considered:** Make the demo depend on rung 1 — it does not work on the only
  device we can test. Drop the priority-caller moment — it is the most persuasive 10 seconds of
  the demo and answers "isn't this just Routines?" better than anything else. Contact-level
  allow-listing beyond starred/contacts scope — Android does not expose per-contact DND
  exceptions to apps, so "parents" maps onto the starred-contacts scope.
- **Impact:** "Parents" is modelled as **starred contacts**, not an arbitrary named group. Whoever
  should ring through must be starred in the device's contacts. That is a product constraint the
  intent layer and the demo script both need to respect. Ally must also snapshot and restore the
  user's original `NotificationManager.Policy`, exactly as it does the interruption filter — the
  probe records `originalPriorityCategories` and `originalCallSenders` for this reason.
- **Not yet verified on the iQOO.** The demo device was unavailable. `DndProbe` exists so this
  is one tap to confirm.

### ADR-108 — Ship a device capability probe rather than re-deriving OEM behaviour by hand
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** `DndProbe.kt` reports, in one call, which ADR-102 rung works, whether
  `AutomaticZenRule` and `ZenPolicy` are accepted, and whether the priority-caller exception is
  expressible. It reverts every mutation, including the original interruption filter and
  notification policy, so it is safe to run on a phone in use.
- **Reason:** Establishing rung 1 was unusable on One UI took three build-install-test cycles and
  two subtly different platform error messages. Repeating that by hand on the iQOO — under
  hackathon time pressure, possibly on the morning of the demo — is the kind of avoidable risk
  worth twenty minutes now. OEM skins diverge from AOSP unpredictably; the probe turns a
  multi-hour investigation into one tap.
- **Alternatives considered:** Re-run the manual T3 sequence on each device — slow and easy to
  get wrong under pressure. Trust that the iQOO behaves like the Samsung — precisely the
  assumption that produced the rung-1 dead end.
- **Impact:** Any new Android device is characterised in seconds. Also useful if the demo phone
  is swapped at short notice. The probe is Phase 1 harness code and is removed with `App.tsx`
  in Phase 2, but `DndProbe.kt` itself should stay.

### ADR-109 — Repeated-caller: Android's bypass for ringing, our rule for detection
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** The "someone urgently needs me" safety net is split in two.
  **Ringing** is Android's own `PRIORITY_CATEGORY_REPEAT_CALLERS`, enabled alongside the
  starred-caller exception. **Detection** of the specified rule — 4 or more calls from one
  caller in a rolling 10 minutes — is `CallLogAnalyzer`, which reports and never rings.
- **Reason:** The rule as specified cannot be implemented. Android does not let an app define
  a repeat-caller window (the platform constant is 15 minutes and is not configurable), and no
  app can un-suppress a specific incoming call: DND is evaluated by the system, in advance,
  against policy. `CallScreeningService` can only silence or reject — it cannot rescue a call
  DND already suppressed, and requires being the default screening app. Building a "4-in-10
  makes it ring" path would have produced a feature that looks right in code and does nothing
  on the phone, which is the exact failure mode this project keeps guarding against.
- **Alternatives considered:** Native bypass only — loses the specified rule entirely.
  Detection only — no actual ring-through, so no safety benefit. Default call-screening app —
  days of work, still cannot un-silence a suppressed call, and puts the demo at risk.
- **Impact:** Persistent callers genuinely ring through, on Android's 15-minute rule rather
  than ours. Ally separately reports "X has called 4 times in 10 minutes" in the result card
  and audit log, which is honest and still useful — it tells the user why their phone rang, or
  that someone is trying to reach them. The two must never be conflated in UI copy.
- **Counting rule:** INCOMING, MISSED, REJECTED and BLOCKED all count — each is someone trying
  to reach you. OUTGOING and VOICEMAIL do not. Numbers are matched on their last 9 digits so
  `+91 98765 43210` and `098765 43210` are one person.
- **Unknown callers are never merged.** Withheld/private/payphone entries are counted as
  unidentified and excluded from per-caller totals: two different withheld callers are not one
  persistent caller, and merging them would manufacture an emergency nobody triggered.
- **Fails conservatively.** Without `READ_CALL_LOG`, or on any query failure, it returns
  `ok:false` with a reason and `thresholdMet:false`. It never guesses a count and never touches
  DND policy.

### ADR-110 — Brightness restores the exact raw value, not the percent
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** `BrightnessController` keeps a percent→raw map of every value it observes and
  writes the exact raw `Settings.System.SCREEN_BRIGHTNESS` back on restore. It also snapshots
  and restores `SCREEN_BRIGHTNESS_MODE`.
- **Reason:** The frozen contract carries brightness as an integer percent, but Android stores
  a 0..255 raw value. Round-tripping raw→percent→raw loses up to one unit: a phone at raw 187
  reports 73%, and 73% converts back to 186. "Restore to exactly what it was" would have been
  quietly false. Verified on device — restoring from raw 187 returns 187, where the percent-only
  path returns 186.
  Adaptive brightness matters for the same reason: if the device is in automatic mode the light
  sensor overwrites a manual write moments later, producing a change that read back as applied
  and then silently reverted.
- **Alternatives considered:** Accept percent-resolution restoration — invisible to the eye but
  makes a promise we do not keep, and the demo's whole argument is that Ally gives your phone
  back exactly. Change the contract to carry raw — leaks a device-specific range into a frozen
  cross-module type and breaks the policy engine's percent semantics.
- **Impact:** A single cached slot was not enough and this was caught on device: the UI
  re-snapshots after each change to refresh its display, which overwrote the original before
  restore could use it. The map fixes that. The cache is process-lifetime only; durable
  restoration across an app kill needs the value persisted in Dhrey's `device_snapshot` table.

### ADR-111 — Priority preferences: remember every channel, enforce only what Android allows
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** `PriorityPreference` records the user's intent per mode, per channel, per
  subject, and carries an explicit `enforceable` flag. Calls and SMS are applied to the device
  through `NotificationManager.Policy`. **WhatsApp is stored and never applied.** The UI must
  show remembered-but-not-enforced as a distinct state.
- **Reason:** Checked against the API 36 SDK with `javap` rather than assumed. The public
  `NotificationManager.Policy` exposes categories CALLS, MESSAGES, CONVERSATIONS,
  REPEAT_CALLERS, ALARMS, MEDIA, EVENTS, REMINDERS, SYSTEM and sender scopes ANY / CONTACTS /
  STARRED, with three constructors — none of which reach per-app or per-contact fields.
  Android 16 *does* hold `mAppBypassDndList` and `mExceptionContacts` internally (both visible
  in `dumpsys notification`), so per-app and per-contact DND bypass exists in the platform and
  is simply not public. Building a WhatsApp toggle that silently did nothing would be the exact
  false-success this project keeps designing against.
- **Alternatives considered:** Omit WhatsApp from the UI — the user asked for it and the intent
  is worth capturing for when the API opens up or for a future NotificationListenerService.
  Claim enforcement and hope — dishonest, and the demo would fail the moment a judge tested it.
  `NotificationListenerService` — can observe and dismiss notifications but cannot grant a DND
  bypass, needs an invasive grant, and is not a hackathon-scale answer.
- **Impact:** Two honest limits now surface in the product rather than hiding in code. First,
  **there is no per-individual-contact exception**: Android offers starred / contacts / anyone,
  so "Mom" means "a starred contact" and the demo contact must actually be starred. Second,
  **WhatsApp is a remembered preference only.** `CHANNEL_ENFORCEABLE` in the frozen types is the
  single source of truth for that distinction so UI and policy cannot disagree.

### ADR-112 — Frozen contract extended for channel-scoped priority preferences
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** Three additive changes to `app/src/types/`, made with Aayush's approval under
  the ADR-006 change protocol: `Channel` + `SenderScope` + `CHANNEL_ENFORCEABLE` in
  `capability.ts`, `PriorityPreference` in `models.ts`, and an **optional** `channel` field on
  `IntentException` in `intent.ts`.
- **Reason:** The frozen contracts could not represent this feature at all. `Preference` is
  keyed by `Capability` (`dnd|brightness|alarm|ringer`) with no notion of a person or a channel.
  `TemporaryOverride` has a `subject` but is time-bounded with `expiresAt`/`active`, which is
  the wrong shape for a standing priority list. And `IntentException` had no channel, so the
  parser could not distinguish "let Mom call me" from "let Mom message me".
- **Alternatives considered:** Overload `TemporaryOverride` with a null expiry — conflates
  "expires" with "permanent" in the one table whose semantics the demo depends on. Store
  priority preferences in the UI layer — a second storage system, explicitly forbidden.
- **Impact:** Purely additive, so nothing existing breaks — verified: `tsc` clean and Shlok's
  21 tests still pass untouched. **Shlok and Dhrey must be told**: Shlok can now set
  `IntentException.channel` (absent means calls, so his existing golden commands are unaffected),
  and Dhrey needs a `priority_preference` table plus a repository. Neither is blocked by this
  change; both are unblocked by it.

### ADR-113 — Four enforcement states, because "saved" and "working" are different promises
- **Date:** 2026-08-29 · **Author:** Aayush · **Phase:** 1 · **Status:** Accepted
- **Decision:** Every priority channel reports one of four states — `enforced`,
  `preference_only`, `unsupported`, `failed` — as `ChannelEnforcement` in the frozen contract,
  with `ENFORCEMENT_PRESENTATION` supplying the UI copy so screens cannot invent their own.
  `setPriority` returns a per-channel breakdown rather than one boolean.
- **Reason:** A single `ok` cannot express what actually happened here. Calls and SMS are
  applied to Android and read back; WhatsApp is stored and never sent to the device at all.
  Both would report `ok: true`, and a UI built on that would tell the user their WhatsApp
  preference was active. `preference_only` exists precisely so that sentence is impossible to
  write by accident. It is the same reasoning as the truthful action-status vocabulary in
  `STATUS_PRESENTATION`, applied one level up to channels.
- **Alternatives considered:** Reuse `ActionStatus` — it has no state meaning "we saved this but
  the platform cannot act on it", and stretching `skipped` to cover that would hide exactly the
  distinction worth surfacing. Return `ok` plus per-channel booleans — encodes the same
  information while letting callers ignore it, which is how the honest case gets dropped.
- **Impact:** `enforced` is only returned after a policy read-back confirms Android held the
  change, so it means the phone will genuinely behave differently. `preference_only` is
  hard-coded for WhatsApp and cannot be reached by a successful device call. The permission and
  unsupported paths carry the same breakdown, so a caller never has to guess which channels were
  affected by a failure.

### ADR-301 — Priority preferences are stored per contact, applied per scope
- **Date:** 2026-08-30 · **Author:** Dhrey · **Phase:** 1 · **Status:** Accepted
- **Decision:** `priority_preference` stores one row per (mode, channel, subject). The policy
  resolver reduces those rows to a per-channel boolean for the device layer and separately
  returns the named subjects and a `requiresStarring` list for the UI.
- **Reason:** The user thinks per person — "let Mom call me during Sleep". Android thinks per
  scope — starred contacts, all contacts, or anyone — and offers no per-individual-contact DND
  exception to apps (ADR-111). Storing only a boolean would throw away the user's actual intent
  and make the Memory screen's provenance impossible. Storing per contact and reducing at the
  boundary keeps the intent intact and puts the lossy step in exactly one place, where it can be
  explained on screen.
- **Alternatives considered:** Store a per-channel boolean — loses who the user named, so we
  could never tell them which contacts to star. Store per contact and pretend Android honours
  it — the false-success this project keeps designing against.
- **Impact:** The screen renders a per-contact list and, for enforceable channels, tells the
  user which of those people must be **starred in Contacts** or they will still be silenced.
  That sentence is the difference between a demo that works and one that mysteriously does not.

### ADR-302 — The screen keeps no copy of the data
- **Date:** 2026-08-30 · **Author:** Dhrey · **Phase:** 1 · **Status:** Accepted
- **Decision:** `PriorityScreen` reads and writes exclusively through `priorityRepository` and
  re-reads after every mutation. The Zustand store holds only UI state — the selected mode and
  the last enforcement result. `enforceable` is set by the repository from
  `CHANNEL_ENFORCEABLE`, never passed in by a caller.
- **Reason:** Two sources of truth is how a preference screen ends up showing a tick for
  something that was never saved. Having the repository own `enforceable` means no screen can
  accidentally mark WhatsApp as enforced by passing the wrong flag — the honest answer is
  structural rather than a matter of remembering.
- **Alternatives considered:** Mirror preferences in the store for snappier rendering — a
  second storage model, explicitly forbidden, and the lists are small enough that re-reading is
  imperceptible.
- **Impact:** The screen takes `onApply` as a prop rather than importing the native layer, so
  it never crosses into Aayush's boundary and is testable without a device. `UNIQUE(profile_id,
  channel, subject)` with an upsert makes re-adding someone idempotent instead of duplicating.
### ADR-114 — The action engine records snapshots through a port, not a repository call
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `executePlan()` writes pre-change values through a `SnapshotStore` interface in
  `app/src/actions/SnapshotStore.ts`, carrying the frozen `DeviceSnapshot` row. Dhrey's existing
  `snapshotRepository` is wired in by `snapshotStoreAdapter.ts`, which is the only file in the
  action engine that knows a database exists and is NOT imported by the executor. `save()` is
  idempotent per `(sessionId, capability)` and the FIRST value written wins.
- **Reason:** Two constraints meet here. `device_snapshot` is Dhrey's table, and an executor that
  called the repository directly would put two owners in one code path and make every executor
  test need SQLite. A port satisfies both while creating no second table, no second row type and
  no second persistence mechanism — the repository is used exactly as published.
  First-write-wins is not a tie-breaker: re-snapshotting a capability mid-session replaces the
  user's original value with one Ally itself set, and restore then puts back Ally's own change.
  That is the bug ADR-110 records, expressed as a key collision so it cannot recur — the row id
  is `sessionId:capability`, which is the table's PRIMARY KEY.
- **Alternatives considered:** Call `snapshotRepository` from the executor — crosses the ownership
  boundary and drags SQLite into every unit test. Return snapshots from `executePlan()` and let
  the caller persist them — the caller can forget, and a plan that dies mid-run loses everything
  already applied. Keep them in module state — untestable and unclearable.
- **Impact:** Verified on device: a Study run wrote `dnd → "off"` and `brightness → 73` into
  `device_snapshot`, and `ringer` correctly produced no row because the action never ran. Capture
  is done; nothing READS these back yet. Restoration is A-V2/Phase 3 and is not claimed here.

### ADR-115 — The executor is handed a device; plan-level state reuses `SessionState`
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** Three rules for `executePlan(plan, deps)`. First, `deps.registry` is a REQUIRED
  `DeviceRegistry` — the executor never imports `src/native` and never reaches for the phone
  itself. Second, progress is reported through an optional `onProgress` callback carrying
  `pending | running | settled`, and those phases are deliberately NOT added to the frozen
  `ACTION_STATUSES`. Third, `summarisePlan()` reports the plan-level answer as
  `ACTIVE | PARTIAL | ERROR` — the existing `SessionState` values — rather than a vocabulary of
  its own. A capability's `requiredPermissions()` is the authority for the permission gate;
  `PlannedAction.requiredPermission` is a policy-time hint, cross-checked and surfaced as
  `declaredPermissionMismatch` on the progress channel.
- **Reason:** A required registry is what makes `mockRegistry` and the Kotlin-backed registry
  genuinely interchangeable (ADR-007) — the seam is a parameter, so nothing can quietly bypass it.
  On progress: `applied`/`failed` describe what happened to the phone and are persisted and shown
  to the user; `pending`/`running` describe where the walk is. Merging them would let a row be
  stored as "running" forever if the app died mid-plan. On the plan-level state:
  `src/memory/session.ts` already says a session starts READY and "the executor moves it to ACTIVE
  once actions are applied", and `endSession()` already takes PARTIAL — so inventing
  `all_applied | partial | none_applied` would have been a third vocabulary for a question the
  codebase had already answered. On permissions, only the capability can see whether the user has
  actually granted anything, but silently preferring one source hides real drift between policy
  and device, so the disagreement is reported without changing the verdict.
- **Alternatives considered:** Default `registry` to the `device` singleton — convenient, but
  importing `src/native` pulls the Expo module resolver into every Node test. Extend
  `ACTION_STATUSES` with `pending`/`running` — a frozen-contract change (ADR-006) to express
  something no `ActionResult` should ever hold. Have the executor call `markSessionActive()`
  itself — that is a database write, which this layer must not perform.
- **Impact:** `executePlan` runs actions strictly in `plan.actions` order, one at a time, and
  returns exactly one `ActionResult` per `PlannedAction`; a failure never aborts the plan.
  `summarisePlan()` returns a state the caller can hand straight to the session layer. Ordering is
  Dhrey's guarantee per docs/CONTRACTS.md §2, so the executor never reorders — for the Study plan
  the three actions are independent and order is irrelevant, but no flag distinguishes that case
  from one where it matters.

### ADR-116 — The exact brightness snapshot lives on disk, not in the heap
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `BrightnessController` persists the exact raw `SCREEN_BRIGHTNESS` value (keyed by
  the percent it reports as) and the user's original `SCREEN_BRIGHTNESS_MODE` to
  SharedPreferences, written with `commit()` rather than `apply()`. `restore(percent)` reads the
  stored raw value and writes it back verbatim; converting the percent is a fallback only, and the
  result reports `exact: false` when that fallback was used. `CapabilityValue` stays a plain
  percent — no frozen-contract change.
- **Reason:** ADR-110 established that restoring the percent loses up to one raw unit: 187 reports
  as 73%, and 73% converts back to 186. The fix at the time was an in-memory `HashMap`, which is
  correct exactly as long as the process lives. It does not. A context routinely outlives its
  process — the user starts Study, Android kills the app under memory pressure, they reopen it and
  end the context an hour later — and by then the map is empty and restore silently returns 186.
  That is the quiet lie this codebase exists to prevent, and it is worse than a loud failure
  because nothing reports it: the write succeeds, the read-back confirms 186, and every status is
  green while the user's setting is gone. `commit()` over `apply()` because the very scenario being
  defended against is the process dying before an async flush completes.
- **Alternatives considered:** Widen `CapabilityValue` or `DeviceSnapshot` to carry the raw value —
  a frozen-contract change (ADR-006) that would leak an Android storage detail into a type Shlok
  and Dhrey both consume, and would put a number the Memory screen cannot render into user-facing
  provenance. Encode `"73:187"` into the percent string — same leak, plus every consumer now has to
  parse it. Store the raw value in `device_snapshot` — that is Dhrey's table and the action engine
  does not write SQL. SharedPreferences is inside the Aayush module, invisible above the capability
  boundary, and costs one file.
- **Impact:** The mode is cleared after a successful exact restore, so the next context captures
  the user's mode fresh rather than pinning them to a stale one. `MockDevice` models the raw/percent
  split for the same reason (ADR-007 parity), which is what lets the 187 → 40% → process death →
  187 case be tested with no phone attached.

### ADR-117 — Restore is snapshot-driven, LIFO with deterministic ties, and never self-clearing
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `restoreSession(sessionId, deps)` walks only persisted snapshots, in LIFO order,
  and returns one `ActionResult` per row using the existing vocabulary. `lifoOrder()` reverses the
  stored array and then applies a *stable* sort by `capturedAt` descending, so equal timestamps
  fall back to reverse-storage order. `summariseRestore()` reports `IDLE` when every row came back
  (counting `skipped` as clean) and `PARTIAL` otherwise, plus `safeToClear`. The function never
  deletes a snapshot and never writes the session row.
- **Reason:** Driving restore from stored rows rather than from the plan is what makes it work
  after a process death — there is no plan in memory to consult — and it means an action that
  never executed is never restored, with no special case, because nothing was ever written for it.
  On ties: `capturedAt` is a millisecond clock and SQL leaves equal keys unordered, so a frozen
  test clock, or simply a fast device, would make restore order depend on the database's whim;
  reversing before a stable sort removes that. On retention: the rows ARE the retry. Deleting them
  after a partial restore would strand the user with a half-changed phone and no way back, so
  clearing is offered to the caller and gated on a clean sweep. `IDLE`/`PARTIAL` are not new
  states — `endSession()` already takes exactly those, and already documents "Pass PARTIAL when a
  restore did not fully succeed, so the snapshots stay meaningful for a retry".
- **Alternatives considered:** Restore from the `ActionPlan` — unavailable after a restart, which
  is the case that matters most. Clear rows automatically on success — convenient until "success"
  is partial, and the executor deleting rows is a database write this layer must not perform. Add
  an `ERROR` restore state — a restore that half-worked is unfinished business with rows still on
  disk, not something to discard, and `PARTIAL` says exactly that. Sort ties by capability name —
  deterministic but arbitrary, and unrelated to the order things were actually applied.
- **Impact:** An empty session restores nothing and reports `IDLE`; there was nothing to put back.
  A permission revoked mid-context yields `PARTIAL` with every row retained, and re-granting it and
  running restore again finishes the job exactly. The caller remains responsible for
  `markSessionActive()` and `endSession()`, unchanged from ADR-115.

### ADR-118 — Context lifecycle is a coordinator over the executor, and the session boundary is a hook
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `ContextCoordinator.ts` exposes `startContext(plan, deps)`,
  `endContext(sessionId, deps)` and `restoreContext(sessionId, deps)`, composing the existing
  `executePlan()` and `restoreSession()` without re-implementing either. It reports progress
  through optional `LifecycleHooks` — `onStarted`, `onActivated`, `onFailed`, `onPartial`,
  `onEnded` — rather than calling Dhrey's session functions itself, so `app/src/actions/` still
  never imports `src/memory`. Its states are the existing `SessionState` values
  (`READY`/`ACTIVE`/`PARTIAL`/`ERROR`/`IDLE`); no new enum. `endContext()` clears snapshots only
  when `summariseRestore().safeToClear`, through the `SnapshotStore` port.
- **Reason:** The execute → summarise → mark-active and restore → summarise → decide-about-rows
  sequences were written by hand in the harness and would have been written again by every caller.
  Each has a rule that is easy to get quietly wrong — never claim ACTIVE when nothing applied,
  never drop snapshots after a half-restore — and those rules belong in one tested place rather
  than in each caller's head. Hooks rather than calls because moving a session row is a database
  write this layer must not make (ADR-114/115), and because a bookkeeping failure upstream must
  not be able to make a device change that already happened look like it did not: a throwing hook
  is caught and the device result stands.
- **Alternatives considered:** Have the coordinator call `markSessionActive()` / `endSession()`
  directly — crosses the ownership boundary and drags SQLite into every coordinator test. Add a
  `FAILED` or `RESTORED` session state — `ERROR` and `IDLE` already mean exactly those, and
  `endSession()` already takes them. Let the caller keep orchestrating — that is what produced the
  bug below.
- **Impact:** `onPartial` is scoped to the RESTORE path only. It originally fired for a partly
  applied plan as well, and the device smoke test caught what that costs: the harness wires
  `onPartial` to `endSession()`, so a PARTIAL apply ended the session it had just started, and the
  next `endContext()` found nothing to end. A hook whose meaning depends on which call fired it
  will be miswired — mine was, within an hour. A partial apply is already fully described by
  `onActivated(sessionId, 'PARTIAL')`, and a regression test now holds that line. Separately, the
  summarisers moved from `index.ts` into `summaries.ts` so the coordinator can use them without
  importing the barrel that exports it — a cycle that worked today and would have broken the first
  time someone moved a call to module-initialisation time.

### ADR-119 — Priority is applied by the lifecycle, as an injected thunk, and reported separately
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `startContext()` accepts an optional `applyPriority: () => Promise<ChannelEnforcement[] | null>`
  and calls it after the plan, only when the plan applied something. The result is returned as
  `StartContextResult.priority` and is never merged into the plan's `PlanSummary`.
- **Reason:** Priority is not a `PlannedAction` — it is not a capability with a value, it has no
  snapshot, and Android expresses it as a notification policy rather than a setting. Adding it to
  `ActionPlan` would mean changing a frozen contract to carry something the executor's ladder
  cannot meaningfully run. But it IS part of what a context does, so something has to sequence it,
  and the coordinator is the only layer that already owns "when a context starts". Passing a thunk
  rather than a request object is what stops a second priority policy growing here: resolution
  stays Dhrey's `applyPriorityForContext()`, the device call stays `applyPriorityPreferences()`,
  and the coordinator cannot see either. Skipping it on `ERROR` preserves the promise that a
  totally failed plan leaves the device untouched.
- **Alternatives considered:** Extend `ActionPlan` with a priority field — a frozen-contract change
  (ADR-006) for something with no snapshot and no read-back. Add a `priority` capability to
  `CAPABILITIES` — it has no single `CapabilityValue`, and its result is per-channel, not one
  status. Let the caller apply priority itself before/after `startContext()` — that is what the
  harness did, and it meant priority was never part of starting a context at all.
- **Impact:** Verified on SM-S928B with "Mom" on Calls only. The consolidated policy went from
  `ALARMS,MEDIA` to `ALARMS,CALLS,REPEAT_CALLERS` — `CALLS` in because Mom is a calls contact,
  `MESSAGES` correctly absent because no SMS contact was listed, `REPEAT_CALLERS` on because the
  emergency bypass is unconditional. Ending the context put the policy back to `ALARMS,MEDIA`.
  The coordinator reported `calls: enforced`, `sms: unsupported`, `whatsapp: preference_only`
  alongside a `PARTIAL` plan — four vocabularies coexisting rather than collapsing.

### ADR-120 — The notification policy is saved on disk, and restored by existence, not by mode
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `DndController` persists the user's original `NotificationManager.Policy` to
  SharedPreferences — **all five int fields**, written with `commit()`, first-write-wins — and
  restores it through a new `restoreSavedPolicy()` that fires whenever a saved policy exists,
  not only when the DND mode being returned to is `off`. `DndCapability.restore()` calls it
  before putting the interruption filter back. A confirmed restore clears the saved copy; a
  permission failure or a mismatch retains it for a retry.
- **Reason:** Two defects, one cause. The saved copy was a field on a Kotlin `object`, so it
  lived exactly as long as the process — and a context routinely outlives its process. Worse
  than a crash: `restorePolicy()` read `null` and did nothing, silently, so a phone kept Ally's
  policy forever with every status reading green. Observed directly during A-V7. And the restore
  was invoked only inside the `mode == "off"` branch, so a user who already had Do Not Disturb on
  before the context got their mode back and silently kept Ally's policy — the borrowed state was
  never returned in the one case where the user had most obviously configured it themselves.
  Existence of a saved policy is the only condition that has anything to do with whether it
  should be given back.
  **All five fields** because Ally mutates the policy through the 3-argument `Policy` constructor,
  which replaces `suppressedVisualEffects` and `priorityConversationSenders` with that
  constructor's defaults. Those two are borrowed whether Ally meant to touch them or not, so
  restoring only the three it sets on purpose would hand the user a policy they never had.
  Confirmed against the API 36 `android.jar`: five public int fields, three constructors, the
  widest taking all five.
- **Alternatives considered:** Put the policy in `device_snapshot` — `DeviceSnapshot` holds one
  scalar per capability, so this would need either a fake `dnd_policy` capability in the frozen
  `CAPABILITIES` allow-list (a pseudo-capability with no value, no permission and no read-back
  for the executor to run) or a five-int blob encoded into `previousValue`, which is rendered as
  user-facing provenance on the Memory screen. Both are frozen-contract damage for something that
  is purely a platform detail of one native controller. Keep restoring on `mode == "off"` and
  document the gap — that is the bug. Save only the three fields Ally writes — a partial
  approximation, which is the thing this codebase most consistently refuses to ship.
- **Impact:** The policy restore no longer depends on the process, the mode, or the order the
  capability happens to be restored in. It is symmetric with ADR-116's brightness fix, so the
  native module now has one durability pattern rather than two. `policySnapshot()` returns the raw
  ints for both saved and current, so exactness can be asserted rather than eyeballed — and while
  adding that I found `describe()` had been emitting Kotlin's escaped-dollar literal
  (`${'$'}{it.priorityCategories}`) instead of the value, making every previous policy log
  meaningless. Fixed in passing; it affected debug output only, never behaviour.

### ADR-121 — Phase 2 navigates with a route switch, not React Navigation
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `src/navigation/` exposes a `Route` union and a `useRoute()` hook. No
  `@react-navigation` dependency. Route is local UI state and is deliberately not put in Dhrey's
  store.
- **Reason:** The Phase 0 comment planned a React Navigation stack, and Phase 2 turned out not to
  need one: three destinations, no nested stacks, no gestures, no deep-link parameters, no header
  chrome. Adding `@react-navigation/native` plus its `react-native-screens`,
  `react-native-safe-area-context` and gesture-handler peers means new NATIVE dependencies and a
  rebuild — at a point where `npm install` already needs `--ignore-scripts` on this machine, and
  where a wrong ABI silently produced an APK that would not install. That is real risk bought for
  a surface a union type covers. Route stays out of the shared store because which screen is on
  top is not a fact about the session; a copy there would disagree the first time a screen changed
  without a session changing.
- **Alternatives considered:** Add React Navigation now — correct eventually, wrong this week.
  Keep the boolean flags the harness had — they were already two, would have become three, and
  each new screen would have added another mutually-exclusive flag nobody could see the invariant
  for. Put the route in Dhrey's `useStore` — a second source of truth for something the UI owns.
- **Impact:** Everything above navigates through `useRoute()`, never a library type, so swapping in
  a real stack in Phase 3 changes this one file and no screens.

### ADR-122 — Emergency detection is integrated as a reader, never as an actor
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 2 · **Status:** Accepted
- **Decision:** `EmergencyMonitor` wraps the existing `CallLogAnalyzer` in a typed seam and is
  called on demand from the Active Context screen. It does not implement the rule, does not write
  anything, and does not act. `detected` and `qualifies` are taken from the analyzer's own output
  rather than recomputed from `count`. An unreadable call log returns `ok: false` with a reason.
- **Reason:** The rule — same caller, 4+ calls, rolling 10 minutes — lives in Kotlin where it is
  tested against the real call-log projection, and duplicating it in TypeScript would give the
  product two answers to the same question, with the user seeing the one nobody tested. Not acting
  matters as much: adding the caller to Priority would create a durable preference the user never
  made, and touching a `DeviceSnapshot` would corrupt the value restore depends on. A detection is
  an observation about the last ten minutes, not a change to the phone. And `ok: false` is kept
  distinct from `detected: false` because "we could not look" and "we looked and nobody called"
  are different answers; collapsing them would report a denied permission as an all-clear.
- **Alternatives considered:** Re-implement the window in TypeScript so it is testable in jest —
  two sources of truth for the product's one safety rule. Auto-add qualifying callers to Priority
  — silently rewrites the user's standing preferences from a transient signal. Poll in the
  background — an always-on service, which NFR-09 rules out.
- **Impact:** Ally reports that someone has been calling repeatedly; ANDROID decides whether that
  rings, through its own repeat-caller bypass on a 15-minute window we do not set (ADR-109). The
  UI copy says exactly that. Verified on device: with no inbound calls the screen reported "No
  caller has reached 4 calls in 10 minutes." The positive case needs a second handset and is NOT
  yet tested on hardware.

### ADR-123 — Restore RELEASES Ally's zen rule; it does not re-assert the mode
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 3 · **Status:** Accepted
- **Decision:** `DndController.release(context, mode)` is the restore path for the interruption
  filter. It deactivates Ally's own `AutomaticZenRule` first, reads the effective mode back, and
  accepts the result if the device landed on the snapshotted value by itself — reporting
  `rung: "zen_rule_released"`. Only when releasing is not enough does it fall through to the
  existing `apply()` ladder, which reports its own rung, so a re-assert is never indistinguishable
  from a clean release. `DndCapability.restore()` calls `dndRelease`, never `dndApply`.
- **Reason:** Restore used to route through `apply(previousMode)`, and `apply` for any mode other
  than `"off"` rebuilds our rule and sets it active. For a user whose Do Not Disturb was already
  on before the context, every check passed: the read-back returned the mode they started in, the
  restore reported `restored`, `summariseRestore` said IDLE and the snapshots were dropped as a
  clean sweep. And their phone was now silent on ALLY'S authority rather than their own, with no
  row left that would ever turn it off. Right value, wrong owner, permanently — a class of failure
  a value-comparing read-back cannot see, because the value really is correct. Standing down first
  is what makes the question answerable: if the mode survives our rule going away, it was never
  ours.
- **Alternatives considered:** Compare rule ownership after applying — Android exposes the
  combination, not which rule won, so there is nothing to compare. Delete our rule on every
  restore instead of deactivating it — re-adding it each session means running
  `addAutomaticZenRule` repeatedly, which ADR-105 records as the call OEM builds reject, to remove
  an inert disabled entry. Special-case `previous === "off"` — that is the one case that already
  worked, and leaves the bug live for exactly the users who had DND on.
- **Device finding that changed the fix.** `dumpsys notification` on the SM-S928B shows our
  EXPLICIT `AutomaticZenRule` is not registered at all — rung 1 is rejected here, so rung 2
  (`setInterruptionFilter`) does the work, and at targetSdk 35+ Android turns that into an
  IMPLICIT rule of ours: `ZenRule[id=implicit_com.ally.assistant, name=Do Not Disturb (Ally)]`.
  Releasing only the explicit rule would therefore have been a no-op on the exact phone we ship
  on. `release()` stands down both, the implicit one via `setInterruptionFilter(ALL)`. Verified
  on hardware that this does NOT cancel the user's own manual rule: with the user's DND on, the
  call left `manualRule` at `STATE_TRUE` and `zen_mode` at 1 — it is scoped to our rule, which is
  the point of the API 35 restriction.
- **Impact:** A disabled "Ally" rule remains listed in the user's Do Not Disturb settings between
  contexts. That is a visible artifact and is documented as one; it holds nothing. `MockDevice`
  now models effective filter state separately from the user's underlying state, which is the only
  way this failure is reachable in a test — with one field, a re-assert and a release look the
  same.

### ADR-124 — Remembered raw brightness is frozen while a borrow is open
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 3 · **Status:** Accepted
- **Decision:** `BrightnessController` freezes everything it remembers while `KEY_BORROWED` is
  present and refreshes it freely otherwise. The borrow is OPENED BY A CONFIRMED `apply()` and
  closed by a confirmed `restore()`. Separately, the borrowed `SCREEN_BRIGHTNESS_MODE` is now
  released on any confirmed restore write rather than only an exact one.
- **Reason:** `DeviceCapability.snapshot()` is called for two different reasons and only one of
  them is a capture. The executor calls it to record the pre-change value; the capability calls it
  again to fill in `beforeValue` on failure results, including the `permission_needed` row a
  blocked restore returns — after Ally has already moved the screen. ADR-110 keyed the memory by
  percent so a different percent could not clobber the original, but 186 and 187 both report as
  73%, so a read taken during the context could still land on the same key and replace the user's
  187 with Ally's 186. The retry after the permission was granted then restored the wrong value
  and reported it as exact. Freezing during a borrow closes that without reintroducing ADR-110's
  own bug: outside a borrow nothing is owed, so a genuine capture still overwrites a stale value
  from a previous session. The mode fix is the same shape — `exact` describes the raw value, not
  the mode, and gating on it left a mode owed forever after an inexact restore, which the NEXT
  session would then hand back from the session before last.
- **Alternatives considered:** A separate non-remembering read for failure paths — a second native
  method and a second rule about which one to call, when the invariant is really about time, not
  about the caller. Key by session — the controller does not know the session and should not.
  First-write-wins unconditionally — restores a stale value from an older session, which is the
  bug ADR-110 was fixing.
- **Impact:** The borrow flag is deliberately its own key rather than reusing `KEY_MODE`: a device
  that cannot report `SCREEN_BRIGHTNESS_MODE` never sets `KEY_MODE`, and the protection would have
  switched itself off on exactly the phones we have not tested.
- **Corrected on device, same day.** The flag was first opened in `snapshot()`, which is wrong in
  both directions and was caught by reading `ally_brightness.xml` after a clean restore on the
  SM-S928B: `borrowed=true` was back, one moment after the restore had cleared it, because the
  screen re-reads brightness to refresh its readout. The next session would then have refused to
  refresh a stale raw value — reintroducing ADR-110 through the fix for ADR-116. A read borrows
  nothing; a write does. The regression test for this had to include that refresh read to
  reproduce it at all, which is worth remembering: the first version of the test passed against
  the bug.

### ADR-125 — The borrowed notification policy is restored through a port, not a snapshot row
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 3 · **Status:** Accepted
- **Decision:** `restoreSession()` takes an optional `BorrowedPolicy` port (`hasSaved()` /
  `restore()`) and consults it after the snapshot walk, ONLY when the session captured no `dnd`
  row. The outcome is reported as an `ActionResult` on `dnd` so it is counted by
  `summariseRestore()`. `src/native/index.ts` selects the native or mock implementation beside the
  registry.
- **Reason:** Priority is applied outside the ActionPlan — the coordinator calls an injected thunk
  after the actions (ADR-119) — and it rewrites `NotificationManager.Policy` whether or not `dnd`
  was ever planned. Restore is snapshot-driven by design (ADR-117), so a context of "dim the screen
  and let Mom through" borrowed the policy with nothing to walk, gave it back never, and reported
  IDLE, because every row it knew about did go back. The policy cannot travel AS a `DeviceSnapshot`:
  that row is keyed by `Capability`, and `CAPABILITIES` is frozen with no member for it. Widening
  the frozen contract for this is not a call one person makes, and a second snapshot table would be
  the duplicate persistence the architecture exists to avoid — so the value stays in the durable
  store `DndController` already owns, under the same rules (first-write-wins capture, cleared only
  on a confirmed read-back, retained on failure). Same contract, different drawer. It is reported
  as a row rather than done quietly because an unrestored policy must make the summary PARTIAL and
  keep the session retryable, and that only happens if it is counted.
- **Alternatives considered:** Add `notification_policy` to `CAPABILITIES` — the honest modelling,
  and a frozen-contract change requiring all three of us; proposed for Phase 4 rather than taken
  unilaterally. Always call the port, even with a `dnd` row — produces a duplicate row and a second
  retry path for the same value. Have the coordinator restore it directly — the coordinator
  composes, it does not reach for devices (ADR-115/118).
- **Impact:** Restoring is now driven by "what was borrowed" from two stores rather than one, and
  the seam is explicit rather than a side effect of DND happening to be in the plan. A caller that
  wires no port still gets correct snapshot-driven restoration.

### ADR-126 — Provenance is preserved by pairing, not by widening `ActionResult`
- **Date:** 2026-08-31 · **Author:** Aayush · **Phase:** 4 · **Status:** Accepted
- **Decision:** `explainResults(plan, results)` pairs each `ActionResult` with the `reason` its
  `PlannedAction` carried, positionally. `startContext()` returns it as `explained`, and the Active
  Context screen renders it beneath each row. `ActionResult` is untouched, nothing is persisted,
  and no sentence is composed here — Dhrey's is copied verbatim.
- **Reason:** Dhrey's resolver already answers "where did this value come from": `ResolvedEntry`
  carries a `source` of command / override / profile / default and a plain-language `reason`, and
  `buildActionPlan()` copies that sentence onto every action. Then it stopped. `ActionResult` has
  no field for it, so the moment the executor turned a planned action into an outcome the
  provenance was gone, and the screen could say what changed but never why. That is the one
  question Ally exists to answer: a phone that dims is a setting; a phone that dims AND can say it
  did so because you taught it to is the product. The pairing lives in the coordinator because that
  is the only place holding both the plan and the outcomes — a caller asked to keep the plan alive
  itself would eventually forget, and the failure mode is silent.
- **Alternatives considered:** Add `reason` to `ActionResult` — the honest modelling, and a change
  to a frozen contract that all three of us own; it also puts a display string into the row the
  executor returns, which is a different kind of thing from a status. Match by `capability` instead
  of position — looks safer, is worse: a plan may legitimately name the same capability twice and
  the first match would be attributed to both rows. Re-read the preference in the UI to explain a
  result — a second source of truth for what drove the device, and one that could disagree with
  what actually ran.
- **Impact:** Positional pairing depends on a guarantee `executePlan()` already makes and documents
  — one `ActionResult` per `PlannedAction`, in the same order. Extra results are kept with a null
  reason rather than dropped, so the policy row `restoreSession()` can append with no plan behind
  it (ADR-125) still reaches the screen. Reasons are cleared on a restore: a restore is driven by
  snapshots rather than a plan, so there is nothing to explain, and leaving the apply's reasons in
  place would caption "Restored" rows with why they were changed in the first place.
