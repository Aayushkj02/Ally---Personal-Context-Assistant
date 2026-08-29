# Ally — Personal Context Assistant

> **Don't configure your phone. Tell it what you're doing.**

Ally is a personal context layer for Android. You say *"I'm going to study for two hours"* and it
loads your saved preferences for studying, checks what Android will actually let it do, **snapshots
your current phone state**, applies only allow-listed actions, and **puts everything back** when the
context ends.

Built for the iQOO Hackathon 2026 in four days by three people.

## What makes it different from Modes & Routines

- **Intent, not configuration.** You describe the activity, not the settings.
- **It remembers *why*.** Every preference shows the sentence that created it.
- **Permanent vs temporary.** "Let my parents call me" is forever; "let the group through for 20
  minutes" expires on its own.
- **Reversible.** Ending a context restores your exact prior state. Routines don't give your phone
  back.
- **Truthful.** Nothing is ever reported as applied without reading the value back. Blocked actions
  say so.

## Architecture in one line

```
voice ─► intent engine (local LLM + on-device fallback) ─► policy engine ─► permission gate
      ─► action engine (snapshot → execute → verify) ─► Android ─► restore on end
```

**The AI never touches an Android API.** It emits schema-validated JSON; deterministic TypeScript
decides what is allowed to execute. See [`FLOW.md`](FLOW.md) for the full picture.

## Stack

| Layer | Choice |
|---|---|
| App | React Native + TypeScript, Expo Dev Build |
| State / nav | Zustand · React Navigation |
| Storage | `expo-sqlite`, local only |
| Intent | Ollama on the laptop + deterministic on-device fallback parser |
| Native | One Kotlin Expo module — DND/Zen, brightness, alarm, permissions |
| Companion | Node bridge + live dashboard (Office Kit surface) |

No cloud AI, no API keys, no accounts. Everything personal stays on the device.

## Getting started

```bash
git clone https://github.com/Aayushkj02/Ally---Personal-Context-Assistant.git && cd Ally---Personal-Context-Assistant/app && npm install
```

Type-check (the gate for every phase):

```bash
npx tsc --noEmit
```

Until the Expo dev build exists, the app runs against `MockDevice` — an in-memory phone that
implements the same interface as the native module. The whole app works without any device.

## Repo layout

```
app/src/types/     FROZEN contracts — see docs/CONTRACTS.md
app/src/ai/        intent engine            (Shlok)
app/src/modes/     declarative mode files   (Shlok)
app/src/domain/    policy engine            (Dhrey)
app/src/memory/    SQLite + repositories    (Dhrey)
app/src/native/    device layer + mock      (Aayush)
app/src/actions/   action engine            (Aayush)
app/src/screens/   split by owner — see docs
bridge/            Ollama proxy + companion dashboard
evals/             golden-command test suite
```

## Working on this

| Doc | What it's for |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Why things are the way they are. Read before proposing a change. |
| [`FLOW.md`](FLOW.md) | How execution actually flows. Update in the same commit as the code. |
| [`docs/CONTRACTS.md`](docs/CONTRACTS.md) | The frozen interfaces between modules. |
| [`docs/DEVICE_NOTES.md`](docs/DEVICE_NOTES.md) | What the hardware really does. |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | The 3½-minute run of show. |

**House rules:** one directory, one owner · `app/src/types/` is frozen · small commits, pushed often
· `DECISIONS.md` and `FLOW.md` stay current with the code · never report success you haven't
verified.

## Team

| | Owns |
|---|---|
| **Aayush** | Native module, device layer, action engine, permissions, entry points |
| **Shlok** | Intent engine, Ollama bridge, fallback parser, mode files, evals |
| **Dhrey** | Data layer, policy engine, design system, screens, companion dashboard |
