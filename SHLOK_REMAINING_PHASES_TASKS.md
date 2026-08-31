# Shlok — Remaining Phase Task List
## AI / LLM / Intent Layer

This document defines your remaining work after completing Phase 2.

Phase numbers are product milestones, not personal deadlines. You may work ahead on your own AI, evaluation, and documentation tasks, but do not bypass frozen contracts or modify another developer's module.

---

# Your Role

You own the AI / LLM / intent-understanding side of Ally.

Primary areas:

```text
app/src/ai/
app/src/modes/
app/src/services/bridgeClient.ts
bridge/src/parse/
bridge/prompts/
evals/
```

You are responsible for:

- natural-language understanding
- structured intent generation
- fallback parsing
- intent validation
- mode and command interpretation
- AI evaluation
- prompt quality
- AI reliability
- AI-side integration with memory/policy
- meaningful AI documentation

You do NOT own:

```text
app/src/native/       → Aayush
app/src/actions/      → Aayush
app/src/navigation/   → Aayush
app/src/memory/       → Dhrey
app/src/policy/       → Dhrey
app/src/components/   → Dhrey
app/src/theme/        → Dhrey
app/src/store/        → Dhrey
app/src/types/        → FROZEN
bridge/src/server/    → Dhrey
```

---

# PHASE 3 — REVERSIBILITY

## Phase Goal

The product gate is:

> When Ally temporarily changes device state, the phone returns to exactly the state it had before the context started.

Your AI responsibility is to correctly represent start, duration, end, undo, and temporary-change semantics.

### S3.1 — Duration Understanding

Support:

```text
"I'm going to study for two hours."
"Focus for 45 minutes."
"Keep this mode on for 30 minutes."
```

Expected:

```text
2 hours  → 120 minutes
45 min   → 45 minutes
30 min   → 30 minutes
```

Do not invent a duration when the user did not provide one.

### S3.2 — End / Stop Commands

Support:

```text
"I'm done studying."
"Stop study mode."
"End this session."
"Turn off this mode."
```

These should produce the correct stop/end intent.

### S3.3 — Undo

Support:

```text
"Undo that."
"Undo the last change."
"Restore my previous settings."
```

AI expresses the reversal request. The AI does not decide which device values to restore.

### S3.4 — Temporary vs Persistent

Correctly distinguish:

```text
"During this study session, let Mom call me."
```

from:

```text
"Always let Mom call me during study."
```

The first is temporary/session-specific. The second is persistent.

### S3.5 — Tests

Add tests for:

- duration extraction
- end commands
- undo commands
- temporary preference language
- persistent preference language
- ambiguous duration
- missing duration
- malformed AI output

Run:

```bash
npm test
npx tsc --noEmit
npm run format:check
npm run eval
```

---

# PHASE 4 — MEMORY & TEACHING

## Phase Goal

The product gate is:

> A preference Ally learns can be traced back to the sentence that taught it.

Your job is to create the correct teaching intent and preserve source information. Dhrey owns database storage.

### S4.1 — Teaching Intent

Support:

```text
"Remember that Mom can call me during sleep."
"Always let my project group reach me while I'm studying."
"Learn that I prefer 40% brightness during study."
"Remember this preference."
```

Represent:

- preference being taught
- mode
- channel/capability
- persistent vs temporary
- source sentence where required

### S4.2 — Source Sentence Preservation

When the contract requires the original command, pass through the actual user sentence rather than replacing it with an AI-generated summary.

Example:

```text
User:
"During study, let my project group message me on WhatsApp."
```

The memory layer must be able to trace the preference back to that source sentence.

### S4.3 — Preference Correction / Removal

Support:

```text
"Actually, don't let my project group message me during study."
"Forget that preference."
"Remove Mom from my sleep priority."
```

Represent whether the preference is being:

- added
- changed
- removed

### S4.4 — Teaching Tests

Test:

- new preference
- correction
- removal
- temporary preference
- persistent preference
- source sentence preservation
- mode-specific teaching
- channel-specific teaching

### S4.5 — Memory Query Intents

Support queries such as:

```text
"What do you remember about my study mode?"
"Why do you let Mom call me during sleep?"
"When did I teach you this?"
```

Produce the correct query intent. Do not fabricate the answer; Dhrey's memory layer is the source of truth.

---

# PHASE 5 — SLEEP & ENTRY POINTS

## Phase Goal

The product gate includes a real alarm in the stock Clock app.

Your responsibility is correct interpretation of sleep/entry-point commands.

### S5.1 — Sleep Intent

Support:

```text
"I'm going to sleep."
"Start sleep mode."
"I'm sleeping now."
```

Map to the existing Sleep mode.

### S5.2 — Wake-Up Time

Support:

```text
"Wake me at 7 AM."
"Wake me at 6:30 tomorrow."
"Wake me at 7 AM on weekdays."
```

Correctly extract:

- time
- date/day information where stated
- recurrence where stated

Do not invent recurrence.

### S5.3 — Sleep + Alarm

Support:

```text
"I'm going to sleep. Wake me at 7 AM on weekdays."
```

Represent both:

```text
sleep context
+
alarm request
```

Aayush handles actual Android alarm creation.

### S5.4 — Alarm Changes

Support:

```text
"Change my wake-up time to 7:30."
"Move tomorrow's alarm to 8."
"Cancel the wake-up alarm."
```

Use the existing alarm/action contract.

Do not call Android alarms from AI code.

### S5.5 — Sleep Tests

Test:

- immediate sleep
- specified wake-up time
- weekday recurrence
- tomorrow
- ambiguous time
- alarm modification
- cancellation
- invalid time
- missing time

---

# PHASE 6 — OFFICE KIT & POLISH

## Phase Goal

Support the approved Office Kit scenarios and make the AI interaction robust for the demo.

Do not invent new capabilities.

### S6.1 — Office Intent Coverage

Add AI/evaluation coverage for the approved Office Kit commands.

### S6.2 — Conversation Robustness

Handle normal variations:

```text
"Start study mode."
"I'm going to study."
"Turn on study."
"I need to focus for two hours."
```

These should map to compatible semantic intents.

### S6.3 — Clarification

For genuinely ambiguous requests:

```text
"Change the setting."
"Let them through."
"Set it for later."
```

do not guess the:

- contact
- mode
- duration
- time
- channel

Ask for clarification according to the existing product rules.

### S6.4 — Confidence / Safety

Review ambiguous and low-confidence outputs.

Prefer clarification or safe rejection over a confident wrong action.

### S6.5 — Evaluation

Extend:

```bash
npm run eval
```

Track:

- intent accuracy
- fallback accuracy
- unsupported-request handling
- ambiguity handling
- regression against prior golden commands

---

# PHASE 7 — HARDEN & DEMO

## Phase Goal

Final demo reliability under normal and degraded conditions.

Your responsibility is AI-side reliability.

### S7.1 — Golden Command Freeze

Freeze the final demo command set.

Maintain coverage for the approved command families:

```text
Study
Sleep
Duration
Priority Calls
Priority SMS
WhatsApp preference
Undo / End
Emergency-related queries
Teaching / Memory
```

Do not casually change the semantics of frozen demo commands.

### S7.2 — Ollama / Network Failure

Test:

```text
Ollama running
Ollama stopped
Network unavailable
```

Verify supported golden commands still use the fallback path where required.

No fake success.

### S7.3 — Malformed Model Output

Inject malformed AI responses.

Expected:

```text
Bad AI output
    ↓
Validator
    ↓
Reject / fallback
    ↓
No invalid ActionPlan
```

### S7.4 — Unsupported Requests

Test requests for unsupported capabilities.

The AI must:

- not invent support
- not claim execution
- produce the correct unsupported or clarification result

Especially preserve:

```text
WhatsApp preference
≠
Android-enforced WhatsApp bypass
```

### S7.5 — Regression Suite

Run the complete AI regression suite after changes to:

- prompts
- fallback parser
- intent schema
- validator

No improvement to one command should silently break another.

### S7.6 — Demo Reliability

Run the final demo scenarios repeatedly.

Track:

- AI success
- fallback success
- latency where useful
- malformed-output handling
- ambiguous-input handling

Document meaningful findings.

---

# CROSS-PHASE TESTING

Before marking any AI task complete:

```bash
npx tsc --noEmit
npm run format:check
npm test
npm run eval
```

Keep AI tests separate from real Android/device tests.

Do not call a placeholder test command proof of device behaviour.

---

# DOCUMENTATION

Use `DECISIONS.md` for meaningful AI/architecture decisions.

Your ADR range:

```text
2xx
```

ADRs are append-only.

If an old decision changes:

```text
new ADR
→ references old ADR
→ explains why it changed
```

Update your assigned section of `FLOW.md` when the AI execution flow changes.

---

# OWNERSHIP RULE

Do not modify another developer's areas:

```text
app/src/native/
app/src/actions/
app/src/navigation/
app/src/memory/
app/src/policy/
app/src/components/
app/src/theme/
app/src/store/
app/src/types/
bridge/src/server/
```

unless a coordinated contract change is required.

If something is missing:

1. Identify the interface mismatch.
2. Explain it.
3. Propose the smallest change.
4. Coordinate with the owner.
5. Do not create a duplicate implementation.

---

# GIT STRATEGY

Start from the latest `dev`.

Recommended branches:

```text
feature/shlok/phase-3-ai
feature/shlok/phase-4-ai
feature/shlok/phase-5-ai
feature/shlok/phase-6-ai
feature/shlok/phase-7-ai
```

Prefer focused commits.

Examples:

```text
feat(ai): add reversible context intents
test(ai): cover temporary and persistent preference language
feat(ai): add teaching intents
test(ai): add sleep and alarm parsing cases
feat(ai): improve ambiguity handling
test(ai): add final demo regression suite
```

Push each branch and open a PR into `dev`.

Do not work directly on `main`.

---

# PRIORITY WHEN TIME IS LIMITED

## Phase 3
1. duration
2. end
3. undo
4. temporary vs persistent

## Phase 4
1. teaching intent
2. source sentence
3. correction/removal
4. memory queries

## Phase 5
1. sleep intent
2. alarm time
3. recurrence
4. alarm modification/cancellation

## Phase 6
1. approved Office Kit commands
2. ambiguity handling
3. evaluation

## Phase 7
1. offline fallback
2. malformed output
3. unsupported requests
4. complete regression suite
5. demo command freeze

---

# FINAL DEFINITION OF DONE

Your remaining work is complete when:

- [ ] approved commands are interpreted reliably
- [ ] fallback works for required golden commands
- [ ] duration/start/end/undo semantics are correct
- [ ] temporary and persistent preferences are distinguished
- [ ] teaching intents preserve required source information
- [ ] memory query intents are represented correctly
- [ ] sleep/alarm language is parsed correctly
- [ ] priority call/SMS/WhatsApp channel semantics are correct
- [ ] WhatsApp is never falsely reported as Android-enforced
- [ ] ambiguous requests are handled safely
- [ ] unsupported capabilities are rejected honestly
- [ ] offline/Ollama failure behaviour is tested
- [ ] malformed responses are rejected safely
- [ ] full AI regression suite passes
- [ ] evaluation remains above the project target
- [ ] TypeScript passes
- [ ] formatting passes
- [ ] documentation is current
- [ ] no ownership boundaries were violated
- [ ] branches are pushed and PRs opened
