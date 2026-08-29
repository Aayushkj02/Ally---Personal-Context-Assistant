# Module Contracts — FROZEN

**These are frozen as of Phase 0 (ADR-006).** Changing anything here requires all three of us to
agree, and **one** person makes the edit. `src/types/` is the executable version of this document;
if the two ever disagree, the code wins and this file is wrong — fix it in the same commit.

`npx tsc --noEmit` is the gate for every phase.

## Why these boundaries exist

Three people, four days. Each contract lets two developers build against an agreed shape without
reading each other's code or waiting on each other's commits.

```
Shlok  ──Intent──►  Dhrey  ──ActionPlan──►  Aayush  ──DeviceCapability──►  Android
```

| Boundary | Producer | Consumer | File |
|---|---|---|---|
| `Intent` | Shlok | Dhrey | `app/src/types/intent.ts` |
| `ActionPlan` / `ActionResult` | Dhrey | Aayush | `app/src/types/policy.ts` |
| `DeviceCapability` / `DeviceRegistry` | Aayush | Dhrey (via action engine) | `app/src/types/device.ts` |
| Bridge HTTP | Shlok + Dhrey | Phone | this document, §4 |
| SQLite schema | Dhrey | Dhrey only | `app/src/types/models.ts` |

---

## 1. `Intent` — Shlok ➜ Dhrey

Defined in `app/src/types/intent.ts`. The AI's **only** output. It never contains executable code,
Android API names, or free-form settings keys.

```ts
interface Intent {
  activity: 'study' | 'sleep' | 'unknown';
  operation: 'activate' | 'deactivate' | 'teach' | 'modify' | 'query';
  durationMinutes: number | null;
  schedule: { kind: 'none' | 'once' | 'weekdays'; time: string | null } | null;
  persistence: 'session' | 'temporary' | 'persistent' | 'unspecified';
  requestedChanges: { capability: Capability; value: string | number }[];
  exceptions: { type: 'contact' | 'contactGroup'; value: string;
                effect: 'allow' | 'block'; durationMinutes: number | null }[];
  confidence: number;              // 0..1
  requiresConfirmation: boolean;
  rawText: string;                 // verbatim — powers Memory provenance
  source: 'ollama' | 'fallback';
}
```

**Guarantees Shlok makes:**

- Every `capability` is in `CAPABILITIES`; every value sits inside `CAPABILITY_DOMAIN`.
- Unknown capabilities are **rejected**, never coerced or guessed.
- `confidence < 0.7` returns a `Clarification` instead of an `Intent` (SRS FR-21).
- `rawText` is the user's exact words — Dhrey persists it as `preference.sourceCommand`.
- The shape is identical whether it came from Ollama or the fallback parser.

**Assumptions Dhrey may make:** the object is already schema-validated. No re-validation needed,
no defensive parsing.

`persistence` semantics, since this distinction is the product's novelty argument:

| Value | Meaning | Storage |
|---|---|---|
| `session` | This run only | Nothing persisted |
| `temporary` | Time-bounded exception | `temporary_override` with `expiresAt` |
| `persistent` | Change the profile | `preference` row |
| `unspecified` | Parser could not tell | Treated as `session` |

---

## 2. `ActionPlan` / `ActionResult` — Dhrey ➜ Aayush

Defined in `app/src/types/policy.ts`.

```ts
interface PlannedAction {
  capability: Capability;
  value: string | number;
  needsSnapshot: boolean;
  requiredPermission: PermissionRequirement['key'] | null;
  reason: string;                  // rendered verbatim in the UI
}
interface ActionPlan { sessionId: string; actions: PlannedAction[]; restoreOnEnd: boolean; }
```

**Guarantees Dhrey makes:** actions are ordered as they should execute; `needsSnapshot` is true for
every restorable mutation; `reason` is plain language a user can read.

**Guarantees Aayush makes:**

- Executes **only** what is in the plan — no inferred extras.
- Never returns `applied` without a read-back that matches (PRD §20, NFR-03).
- One failure does not abort the plan; each row reports independently.
- Returns exactly one `ActionResult` per `PlannedAction`, in the same order.

```ts
type ActionStatus =
  | 'applied' | 'permission_needed' | 'not_supported'
  | 'skipped' | 'failed' | 'restored';
```

This vocabulary is user-visible and is a rubric item. `STATUS_PRESENTATION` in `policy.ts` is the
single source of truth for its labels and colours — the UI must not invent its own.

---

## 3. `DeviceCapability` — Aayush's native surface

Defined in `app/src/types/device.ts`. **Both** the Kotlin-backed module and `MockDevice` implement
it identically (ADR-007).

```ts
interface DeviceCapability {
  isAvailable(): Promise<boolean>;
  requiredPermissions(): Promise<PermissionRequirement[]>;
  snapshot(): Promise<CapabilityValue | null>;
  execute(value: CapabilityValue): Promise<ActionResult>;
  restore(previous: CapabilityValue): Promise<ActionResult>;
}
```

- `isAvailable()` must be **honest**, not optimistic — a `false` here produces `not_supported` and
  that is a better outcome than a fake success.
- `snapshot()` returns `null` for one-shot capabilities (alarm), which the action engine reads as
  "nothing to restore".
- **Parity obligation:** when this interface or the native implementation changes, `MockDevice.ts`
  changes in the **same commit**.

---

## 4. Bridge HTTP — phone ➜ laptop

```
POST /parse    { text, activeContext? }       → Intent        2500 ms timeout → fallback
POST /session  { event, sessionId, payload }  → 204           fire-and-forget
GET  /health   →  { ok, model }                               drives the "local AI" chip
```

**Every bridge call is optional.** A dead bridge must never produce a spinner, an error dialog, or a
blocked UI. `POST /session` is fire-and-forget; failures are swallowed. The phone is fully
functional standalone — that is the guarantee ADR-003 exists to protect.

---

## 5. SQLite schema — Dhrey only

Row types in `app/src/types/models.ts`. Local-only; no cloud, no accounts, no sync (PRD §21).

```sql
context_profile(id, name, mode_key, created_at, updated_at)
preference(id, profile_id, capability, value, source, source_command, created_at)
temporary_override(id, profile_id, capability, value, subject, effect,
                   start_at, expires_at, active, source_command)
context_session(id, profile_id, started_at, ends_at, status)
device_snapshot(id, session_id, capability, previous_value, captured_at)
command_log(id, raw_text, intent_json, confidence, source, created_at)
action_execution(id, command_id, capability, status, reason, before_value, after_value)
permission_state(key, granted, checked_at)
```

Two columns carry product weight and must not be dropped as an optimisation:

- **`preference.source_command`** — the verbatim sentence behind a remembered preference. It is what
  the Memory screen shows and what answers "isn't this just Routines?".
- **`device_snapshot.previous_value`** — the restoration source of truth. Restore reads these rows;
  it never recomputes what a context "probably" changed.

---

## 6. Mode definition files — Shlok

`app/src/modes/study.json`, `app/src/modes/sleep.json`. Declarative defaults, lowest precedence.

Changing a mode's default behaviour must require **zero code changes**. If you find yourself editing
TypeScript to change what Study does, the mode file schema is wrong — fix the schema.

---

## Change protocol

1. Raise it with all three of us. No silent edits.
2. One person makes the change, in `src/types/` and here, in the same commit.
3. Write an ADR in your own range explaining why, with `Supersedes:` if it replaces one.
4. `npx tsc --noEmit` must be clean before the commit lands.
