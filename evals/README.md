# Intent Eval Suite

OWNER: SHLOK — task S8.

`npm run eval` scores the intent engine against paraphrases of the golden commands
and prints a pass rate per Intent field.

## The rule that matters

The suite must pass **with Ollama running AND with it stopped**. Fallback parity is
not optional — it is the demo insurance ADR-003 exists to provide.

## Targets

| Phase | Cases | Pass rate |
|---|---|---|
| 1 | 40 | >= 70% |
| 2 | 80 | >= 85% |
| 3 | 80+ | >= 90% |

Put the final number on a slide. It is cheap, credible technical depth.

## Golden commands (SRS §17.2)

1. "When I study, keep silent and let my parents call me."  -> teach Study
2. "I'm going to study for two hours."                      -> activate + 120 min
3. "Let my project group through for 20 minutes."           -> temporary override
4. "I'm done studying."                                     -> end + restore
5. "I'm going to sleep. Wake me at 7 AM on weekdays."       -> sleep + alarm
6. "Change Study brightness to 50%."                        -> persistent update
7. "Undo that."                                             -> restore previous
