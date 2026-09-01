# Dhrey — Remaining Phase Task List
## Memory / Policy / Data / UI / Integration

This document defines your remaining work after Phase 2.

Phase numbers are product integration milestones. You may work ahead on your own memory, policy, data, UI, session, and bridge tasks, but do not bypass frozen contracts or modify another developer's module.

---

# Your Role

You own the data, memory, policy, shared UI foundation, store, session-sync, and server side of Ally.

Primary areas:

```text
app/src/memory/
app/src/policy/
app/src/components/
app/src/theme/
app/src/store/
app/src/services/sessionSync.ts
bridge/src/server/
```

You are responsible for:

- SQLite/data persistence
- profiles and preferences
- temporary overrides
- sessions and snapshots
- deterministic policy resolution
- ActionPlan generation
- priority preferences
- shared UI components
- shared state
- session synchronization
- server-side bridge support where approved
- testing of memory/policy/data behaviour

You do NOT own:

```text
app/src/ai/             → Shlok
app/src/modes/          → Shlok
app/src/native/         → Aayush
app/src/actions/        → Aayush
app/src/navigation/     → Aayush
app/src/types/          → FROZEN
bridge/src/parse/       → Shlok
bridge/prompts/         → Shlok
evals/                  → Shlok
```

---

# PHASE 2 — COMPLETE THE FIRST VERTICAL SLICE

## Phase Goal

The gate is:

> One natural-language sentence changes the real Samsung Galaxy S24 Ultra.

Primary command:

```text
"I'm going to study for two hours."
```

Target flow:

```text
Shlok
  ↓
Validated Intent
  ↓
Dhrey
  ↓
Memory / Profile
  ↓
Policy
  ↓
ActionPlan
  ↓
Aayush
  ↓
Samsung
```

Your critical responsibility is to make:

```text
Validated Intent → ActionPlan
```

reliable.

---

## D-V1 — PolicyEngine

Complete the deterministic `PolicyEngine.resolve()` implementation.

Precedence remains:

```text
Current instruction
        ↓
Temporary override
        ↓
Persistent preference
        ↓
Default
```

The policy layer must not ask the LLM to decide precedence.

Add real tests for:

- default
- persistent preference
- temporary override
- current instruction
- override expiry
- conflicting rules

---

## D-V2 — ActionPlanner

Complete `ActionPlanner` so a resolved policy becomes the existing frozen `ActionPlan`.

Do not create a second ActionPlan type.

Target:

```text
Study Intent
    ↓
Study profile
    ↓
PolicyEngine
    ↓
ActionPlanner
    ↓
ActionPlan
```

The ActionPlan must be directly consumable by Aayush's existing executor.

---

## D-V3 — Complete the Study Vertical Slice

Make this scenario work:

```text
"I'm going to study for two hours."
```

Expected:

```text
Intent
  ↓
Study profile
  ↓
Policy
  ↓
ActionPlan
  ↓
Aayush executor
```

Your part is complete when the correct ActionPlan reaches Aayush without hard-coded duplicate policy logic.

---

## D-V4 — SnapshotRepository

Finish persistent snapshot storage behind the existing SnapshotStore abstraction.

Requirements:

- store the actual pre-context state
- retrieve by session/context
- preserve original state
- first write wins for the initial snapshot
- do not overwrite the original state with later state

Preserve the values required by the existing restoration flow, including:

```text
brightness
DND interruption filter
NotificationManager.Policy
```

Do not create a second snapshot system.

---

## D-V5 — Session / Context Lifecycle

Complete the data/session side of:

```text
START
  ↓
snapshot
  ↓
apply ActionPlan
  ↓
active context
  ↓
END
  ↓
restore
```

Represent:

- active mode
- start time
- end time/duration
- session identity
- temporary overrides
- restore/snapshot relationship

Do not create a second context manager.

---

# PHASE 3 — MEMORY & REVERSIBILITY

## Phase Goal

The phone returns to the exact state that existed before a temporary context.

Your responsibility is persistent session/memory support.

---

## D3.1 — Full Snapshot Persistence

Make snapshots survive beyond a single in-memory process where required by the architecture.

Verify:

```text
read original state
→ save snapshot
→ change state
→ retrieve snapshot
→ restore original state
```

Test duplicate writes.

The original snapshot must not be replaced by the changed state.

---

## D3.2 — Restore Repository / History

Create the data structures required to retrieve context history.

Support useful information such as:

- context name
- start/end
- actions applied
- original values
- restore status

Do not store sensitive information unnecessarily.

---

## D3.3 — Undo / Reversal Data

Support the memory side of:

```text
"Undo that."
"Restore my previous settings."
```

Store enough information for the system to locate the relevant previous context/action.

The actual Android restoration remains Aayush's responsibility.

---

## D3.4 — Temporary Overrides

Ensure temporary preferences have:

- creation time
- expiration time
- mode
- channel/subject
- active/expired state

Verify expired overrides no longer affect policy.

---

# PHASE 4 — MEMORY & TEACHING

## Phase Goal

A taught preference can be explained and traced to its source sentence.

---

## D4.1 — Preference Repository

Support persistent preferences for:

- mode
- channel
- contact/group
- setting/action
- enabled/disabled
- source command

Do not allow the UI to invent whether a channel is enforceable.

Preserve the repository's existing enforcement rules.

---

## D4.2 — Teaching / Learning Storage

Store preferences created from teaching intents.

Example:

```text
"Remember that Mom can call me during sleep."
```

Persist:

```text
mode = sleep
channel = calls
subject = Mom
source_command = original user sentence
```

Use the existing contract.

---

## D4.3 — Preference Updates

Support:

```text
"Actually, don't let Mom call me during sleep."
"Forget that preference."
"Change my study brightness preference."
```

Make updates deterministic.

Do not create duplicate rows where the existing unique/upsert design applies.

---

## D4.4 — Memory Queries

Support retrieval needed for:

```text
"What do you remember about study?"
"Why can Mom call me during sleep?"
"When did I teach you this?"
```

The database is the source of truth.

Do not let the AI invent stored memories.

---

# PHASE 5 — SLEEP & ENTRY POINTS

## Phase Goal

A real alarm exists in the stock Clock app and Sleep mode works reliably.

Your responsibility is the memory/policy/session side.

---

## D5.1 — Sleep Profile

Complete the Sleep profile/defaults in the data layer.

Support mode-specific settings without duplicating the mode definition elsewhere.

---

## D5.2 — Alarm Intent Data

Store the information needed for alarm execution:

- requested time
- date/day
- recurrence
- associated Sleep context/session

Aayush performs the Android alarm operation.

---

## D5.3 — Weekday Recurrence

Persist recurrence rules such as:

```text
weekdays
tomorrow
specific date
```

Use the existing contracts.

Do not invent new recurrence formats.

---

## D5.4 — Sleep Session

Connect:

```text
Start Sleep
    ↓
Sleep context
    ↓
alarm metadata
    ↓
End/restore
```

Ensure the session can be queried later.

---

# PHASE 6 — OFFICE KIT & POLISH

## Phase Goal

Prepare and support the approved Office Kit workflow in software, and provide a stable shared UI/data foundation.

> **Important clarification about Office Kit availability**
> 
> The team **does NOT have the Office Kit right now**.
> 
> The Office Kit will be provided **only if we qualify for the Pune round**. Until then, the team is developing and testing the prototype using **Aayush’s Samsung Galaxy S24 Ultra**.
> 
> **Current stage (before Pune qualification):**
> * Use the **Samsung Galaxy S24 Ultra** for available device-level testing.
> * Dhrey focuses on the **data, memory, policy, session, UI, store, and integration logic** required for the approved Office Kit scenarios.
> * Office Kit scenarios can be implemented and tested at the software/data/logic level without the physical kit.
> * Do not block completion of Phase 6 on having Office Kit hardware.
> 
> **After qualifying for the Pune round:**
> * The team receives the physical Office Kit.
> * Hardware-specific validation and integration testing can then be performed against the actual Office Kit.
> 
> We are strictly preparing and supporting the approved Office Kit workflow, not physically testing the Office Kit.

Do not invent new Office Kit capabilities or add unnecessary hardware requirements.

---

## D6.1 — Office Session Data

Support the approved Office Kit session information in the data layer.

---

## D6.2 — Shared UI Components

Improve reusable components needed by the approved flows:

- cards
- buttons
- status rows
- mode indicators
- preference rows
- action status
- warning/error states

Keep components reusable rather than screen-specific.

---

## D6.3 — Shared Store

Keep Zustand responsible for shared UI/application state only.

Do not store the database itself in Zustand.

Expected separation:

```text
Repository
   ↓
Domain / Policy
   ↓
Store
   ↓
UI
```

---

## D6.4 — Priority UI

Maintain the Priority screen with:

```text
Priority
├── Calls
├── SMS
├── WhatsApp
└── Emergency Calls
```

Mode-aware:

```text
Study
Sleep
Focus
```

The UI must accurately show:

```text
Calls → enforceable
SMS → enforceable
WhatsApp → preference_only
```

If Android requires starred/priority contacts, show that requirement clearly.

Do not show an empty list as "not supported."

---

## D6.5 — Priority Editing

Allow the user to:

- add a contact
- remove a contact
- enable/disable priority
- select a channel
- select a mode
- add a WhatsApp group preference

Use Dhrey's repository.

Do not create UI-local storage.

---

# PHASE 7 — HARDEN & DEMO

## Phase Goal

Three clean demo runs, including degraded conditions.

Your responsibility is reliability of data, policy, state, and UI.

---

## D7.1 — Persistence Failure Handling

Test:

- database unavailable
- migration failure
- missing record
- corrupted/invalid preference data

Fail safely.

Do not claim a preference exists when it cannot be read.

---

## D7.2 — Policy Regression Suite

Run complete tests for:

- precedence
- overrides
- profiles
- priority
- ActionPlan generation
- session state
- snapshot handling
- restore lookup

---

## D7.3 — Context Crash / Restart Recovery

Test what happens if the application is restarted while a context is active.

Verify the system can determine:

- which context was active
- whether a snapshot exists
- whether restoration is required

Do not silently lose restoration information.

---

## D7.4 — UI Error States

Ensure the UI clearly distinguishes:

```text
loading
success
permission_required
unsupported
preference_only
failed
```

Do not show success when persistence or policy resolution failed.

---

## D7.5 — Demo State Reset

Provide a safe way to reset demo/test state without manually deleting arbitrary database files.

Make it clear when demo data is being reset.

Do not include destructive reset behaviour in the normal user flow.

---

# CROSS-PHASE TESTING

Before completing a phase/task:

```bash
npx tsc --noEmit
npm run format:check
npm test
```

Add real tests for your data/policy functionality.

Where the project has an evaluation command, keep it green:

```bash
npm run eval
```

Do not treat placeholder tests as meaningful coverage.

---

# DOCUMENTATION

For meaningful architecture/data/policy decisions:

```text
DECISIONS.md
```

Use Dhrey's ADR range:

```text
3xx
```

ADRs are append-only.

Update your assigned sections of:

```text
FLOW.md
```

when the data/policy/session flow changes.

Document important platform limitations and data-model decisions.

---

# OWNERSHIP RULE

Do not modify:

```text
app/src/ai/
app/src/native/
app/src/actions/
app/src/navigation/
app/src/types/
bridge/src/parse/
bridge/prompts/
evals/
```

unless a coordinated contract change is required.

Do not create duplicate:

- ActionPlan models
- Intent models
- snapshot stores
- policy engines
- priority repositories
- database systems

There should be one source of truth for each responsibility.

---

# GIT STRATEGY

Start each phase branch from the latest `dev`.

Recommended branches:

```text
feature/dhrey/phase-3-memory
feature/dhrey/phase-4-memory-teaching
feature/dhrey/phase-5-sleep
feature/dhrey/phase-6-office-kit
feature/dhrey/phase-7-hardening
```

Keep commits focused.

Examples:

```text
feat(memory): complete snapshot repository
feat(policy): complete action planner
test(policy): add precedence regression suite
feat(memory): add teaching preference persistence
feat(sleep): persist alarm metadata
feat(ui): improve priority settings
test(data): add persistence failure tests
```

Push branches and open PRs into `dev`.

Do not push directly to `main`.

---

# PRIORITY WHEN TIME IS LIMITED

## Phase 2
1. PolicyEngine
2. ActionPlanner
3. Study vertical slice
4. SnapshotRepository
5. Session lifecycle

## Phase 3
1. exact snapshot persistence
2. restore history
3. undo
4. temporary overrides

## Phase 4
1. preference repository
2. teaching storage
3. corrections/removals
4. memory queries

## Phase 5
1. Sleep profile
2. alarm metadata
3. recurrence
4. sleep session

## Phase 6
1. Priority UI
2. shared components/store
3. Office Kit data/session support
4. polish

## Phase 7
1. persistence failure handling
2. policy regression
3. restart recovery
4. UI error states
5. demo-state reset

---

# FINAL DEFINITION OF DONE

Your remaining work is complete when:

- [ ] Intent can be resolved into a deterministic policy
- [ ] Valid ActionPlans are produced
- [ ] Snapshots persist and can be retrieved
- [ ] Exact pre-context values are preserved
- [ ] Temporary overrides expire correctly
- [ ] Teaching preferences are persisted
- [ ] Source commands are preserved where required
- [ ] Memory queries use the database as the source of truth
- [ ] Sleep/alarm data is persisted correctly
- [ ] Priority calls/SMS/WhatsApp preferences are represented correctly
- [ ] WhatsApp remains `preference_only`
- [ ] Shared UI/store are separated from persistence
- [ ] Policy/data tests are real and meaningful
- [ ] Crash/restart recovery is handled
- [ ] UI error states are honest
- [ ] TypeScript passes
- [ ] Formatting passes
- [ ] Documentation is current
- [ ] Ownership boundaries are respected
- [ ] Branches are pushed and PRs opened

---

# Final Product Goal

Your work should make Ally reliable at answering:

> "What should Ally remember?"
>
> "Which rule should win?"
>
> "What should happen during this context?"
>
> "What should be restored when the context ends?"

Keep the data and policy layer deterministic, testable, and independent from Android implementation.
