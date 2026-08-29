# Shlok — Phase 1 Tasks (AI / LLM)

Hey Shlok 👋

Your main responsibility in Phase 1 is the **AI part of Ally**.

You will work mainly inside:

    app/src/ai/
    app/src/modes/
    bridge/src/parse/
    bridge/prompts/
    evals/

Please avoid changing other people's areas unless we discuss it first.

---

## 1. Your Git Branches

Start from the latest `dev` branch.

For the first task:

    git checkout dev
    git pull --rebase origin dev
    git checkout -b feature/shlok/fallback-parser

Later, create the other branches mentioned below.

---

# Task S3 — Fallback Parser

### What you need to do

Build a simple parser that can understand Ally's important commands **without using the internet or an AI model**.

This is our backup when Ollama/Gemini is unavailable.

The fallback parser should handle the 7 golden commands defined by the project.

The main goal is:

> Even if the AI is completely offline, Ally should still understand the important demo commands.

### Important

Keep it simple and predictable.

Do NOT try to build a general-purpose AI parser.

### Expected flow

    User sentence
        ↓
    Fallback Parser
        ↓
    Structured Intent
        ↓
    Validator

### Done when

- All 7 golden commands can be parsed.
- It works with the network turned off.
- Output follows the frozen contract in `app/src/types/`.
- Add tests for the important commands.
- TypeScript passes.

---

# Task S4 — Intent Validator

After the parser creates an intent, your validator checks whether it is valid and safe.

### It should check things like:

- Is the activity valid?
- Is the requested operation supported?
- Are required values present?
- Are values within allowed ranges?
- Are unknown capabilities rejected?

For example:

    Unknown capability
          ↓
       REJECT

Do not silently convert an unknown request into something else.

### Important

The validator is an important safety boundary.

The AI should NEVER directly execute Android actions.

It should only produce a structured intent.

---

# Task S6 — Mode Files

Create the initial mode definitions for:

- Study
- Sleep

Use the existing project contracts and PRD/SRS as the source of truth.

Keep these files simple and structured.

Do not put Android execution logic inside them.

---

# Later: S1 + S2 — Ollama / AI Bridge

After the fallback parser and validator are working, move to:

    feature/shlok/ollama-bridge

These tasks cover the AI/LLM side.

The general flow will be:

    User command
          ↓
    Ollama / LLM
          ↓
    Structured Intent
          ↓
    Intent Validator

Remember:

**The LLM interprets the request. It does NOT control the Android phone directly.**

The system should also be able to fall back to S3 if the LLM is unavailable.

---

# Later: S8 — Evaluation

Create:

    feature/shlok/eval-harness

The evaluation should test how reliably the AI/parser handles the project's important commands.

The target from the current plan is:

    npm run eval ≥ 70%

Also test the fallback path with Ollama stopped.

---

# Files You Own

You are primarily responsible for:

    app/src/ai/
    app/src/modes/
    app/src/services/bridgeClient.ts
    bridge/src/parse/
    bridge/prompts/
    evals/

---

# Please Avoid These Areas

Do NOT modify these unless we coordinate:

    app/src/memory/       → Dhrey
    app/src/policy/       → Dhrey
    app/src/native/       → Aayush
    app/src/actions/      → Aayush
    app/src/navigation/   → Aayush
    app/src/types/        → FROZEN
    bridge/src/server/    → Dhrey

The shared contracts in `app/src/types/` are frozen. Build your code around them rather than changing them.

---

# Git Rules

Keep your commits small and clear.

Examples:

    feat(ai): implement fallback parser
    test(ai): add fallback parser tests
    feat(ai): add intent validator
    feat(ai): add study and sleep modes

Push your branch after completing a meaningful task.

Open a PR into `dev`.

Do NOT directly push your work to `main`.

---

# Documentation

If you make an important architectural decision:

1. Add it to `DECISIONS.md` using your assigned ADR range.
2. Do not edit someone else's ADR.
3. If `FLOW.md` needs an update, update only your assigned section.

---

# Your Recommended Order

Do the work in this order:

    S3 — Fallback Parser
          ↓
    S4 — Intent Validator
          ↓
    S6 — Mode Files
          ↓
    S1 + S2 — Ollama / AI Bridge
          ↓
    S8 — Evaluation

S3 is first because it gives us a working backup before depending on the LLM.

---

# Definition of Done

Before saying your task is complete:

[ ] Code is implemented
[ ] Tests are added
[ ] `npx tsc --noEmit` passes
[ ] Relevant evaluation passes
[ ] No unrelated files changed
[ ] Documentation updated if needed
[ ] Changes committed
[ ] Branch pushed
[ ] PR opened into `dev`

---

## Main Goal

Don't try to make the AI complicated.

For Phase 1, we want:

**simple + reliable + testable.**

A parser that works reliably during the demo is more valuable than a complicated AI system that sometimes fails.

Good luck! 🚀
