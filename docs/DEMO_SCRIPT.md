# Demo Script — 3 min 30 s

**Owner: Dhrey (narrative) · Aayush (drives the phone).** Rehearse five times. Record a backup video
by 18:00 on Day 4 — that video is the single highest-value piece of insurance in the project.

## Pre-flight — before you walk up

- [ ] All permissions pre-granted, onboarding already completed
- [ ] Ollama running, model warm (send one throwaway request)
- [ ] `adb reverse tcp:11434 tcp:11434` connected over USB — **never venue Wi-Fi**
- [ ] Brightness at ~80% so the drop is visible from the back of the room
- [ ] Phone mirrored to the projector, notifications from other apps cleared
- [ ] Teammate ready to send a notification, and to call from a contact saved as "Mom"
- [ ] Second override pre-created with ~30 s left, so an expiry lands on camera
- [ ] Backup video open in another tab

## Run of show

| # | Time | Action | What the judge sees |
|---|---|---|---|
| 1 | 0:00 | *"We all reconfigure our phones ten times a day. Silent for class. Dim at night. And then you have to undo all of it."* | The problem, phone in its normal state |
| 2 | 0:15 | **"Hey Gemini, open Ally."** Then in-app: *"When I study, keep it silent, block notifications, but let my parents call me, and set brightness to 40%."* → confirm | Natural language becomes a saved profile |
| 3 | 0:50 | *"I'm going to study for two hours."* Teammate sends a notification → **silence**. Teammate calls from "Mom" → **it rings** | **The wow moment.** DND icon appears, brightness visibly drops, timer starts, real calls behave differently |
| 4 | 1:50 | *"Let my project group through for the next 20 minutes."* Open **Memory** screen | Parents = **Persistent**. Project group = **Temporary**. *"Ally knows the difference between what you meant forever and what you meant for now."* |
| 5 | 2:20 | *"I'm done studying."* | **Centerpiece.** Brightness returns to exactly 80%, DND off, every row reads `Restored`. *"No routine app gives you your phone back."* |
| 6 | 2:50 | *"I'm going to sleep. Wake me at 7 on weekdays."* Then **open the stock Clock app** | The alarm is really there, Mon–Fri. Not a mock |
| 7 | 3:15 | Turn to the laptop dashboard, then one architecture slide | *"A local model extracts intent. Deterministic code decides what may execute. The AI never touches an Android API."* |

## Do NOT show

- Any permission dialog — pre-grant everything
- Onboarding — pre-complete it
- Anything depending on venue Wi-Fi — USB only
- A real 20-minute wait — state the expiry, show the countdown, move on
- Focus/Work mode — not built (ADR-004)
- Raw JSON on screen for more than two seconds

## If something breaks

| Failure | Recover with |
|---|---|
| Ollama unreachable | Say nothing and keep going — the fallback parser handles it. If asked, that's a feature: *"that just ran fully on-device."* |
| DND blocked on the device | *"Android requires explicit permission for this — and notice Ally says so rather than pretending."* Truthful failure beats a fake success |
| An action fails mid-demo | Point at the status chip. The honesty **is** the product |
| App crashes | Reopen — the session reloads from SQLite. Show that as recoverability |
| Total loss | Cut to the backup video |

## Anticipated questions

**"Isn't this just Android Modes & Routines?"**
Routines are configuration-first and destructive. Ally is intent-first, remembers *why* it knows
something, distinguishes permanent from temporary, and restores your exact prior state. Show Memory.

**"Where does the AI actually run?"**
A local model on our own machine — no cloud, no API key, nothing leaving the network. And if it's
unavailable, the on-device parser carries every command. *(Kill Ollama live and re-run a command —
strong move, but only if rehearsed.)*

**"Why can't Gemini trigger Study Mode directly?"**
Google deprecated App Actions; AppFunctions replaces it on Android 16 but is still limited-access.
We've declared the interface so Ally is ready the day it opens up.

**"What happens if a setting can't be restored?"**
The session is marked partial and the snapshot is kept so it can be retried. We never claim a
restore we didn't verify.
