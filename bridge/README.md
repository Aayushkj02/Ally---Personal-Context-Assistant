# Ally Bridge

One Node/TypeScript process on the laptop serving two unrelated jobs. Same process,
different files, so Shlok and Dhrey never touch the same code.

| Route | Owner | Task | Purpose |
|---|---|---|---|
| `POST /parse` | Shlok | S2 | Ollama proxy, JSON-schema constrained output |
| `GET /health` | Shlok | S2 | Drives the "local AI connected" chip |
| `POST /session` | Dhrey | D6 | Phone pushes session events, fire-and-forget |
| `GET /dashboard` | Dhrey | D7 | Live companion view (Office Kit surface) |

## Ownership

```
bridge/src/parse/    SHLOK   Ollama client, schema, model config
bridge/prompts/      SHLOK   system prompt — lives HERE, not in the app (ADR-002)
bridge/src/server/   DHREY   HTTP server, session events, dashboard
```

`bridge/prompts/` is on the laptop deliberately: Shlok tunes the prompt without
rebuilding the APK. That is the main velocity reason we chose a local bridge at all.

## Transport

At demo time: `adb reverse tcp:11434 tcp:11434` over USB. **Never venue Wi-Fi.**

## Contract

Every bridge call is optional. A dead bridge must never produce a spinner, an error
dialog, or a blocked UI on the phone. See `docs/CONTRACTS.md` §4.
