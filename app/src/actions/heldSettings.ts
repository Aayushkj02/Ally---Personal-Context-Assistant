/**
 * OWNER: AAYUSH — task A6.1 / A6.7
 *
 * What Ally is still holding, recovered from disk after the app has been killed.
 *
 * FOUND ON THE SAMSUNG, NOT IN A TEST. Start a Study context on SM-S928B, swipe Ally away, reopen
 * it. The session comes back correctly — Dhrey's `getActiveContext()` is durable and the countdown
 * resumes from the persisted `endsAt`. The per-action results do not: they live in React state in
 * the shell, and a process death empties them. The Active Context screen then rendered
 *
 *     0/0 changes applied · session active
 *     What Ally changed:  Nothing yet.
 *
 * while the phone was genuinely sitting at DND=priority and brightness 64/255. Nothing was
 * fabricated — the screen under-reported — but it still told the user something untrue about their
 * own phone, which is the failure mode the whole status vocabulary exists to prevent. A person who
 * believes Ally is holding nothing has no reason to press End, and their phone stays dimmed.
 *
 * THE SNAPSHOTS ARE THE ANSWER, AND THEY WERE ALREADY THERE. `device_snapshot` records the value
 * of every capability Ally touched BEFORE it touched it, it is written through
 * `snapshotStoreAdapter` into Dhrey's table, and it survives process death — it has to, because it
 * is what restore reads. So the durable answer to "what is Ally holding?" already existed on disk;
 * nothing here is a new source of truth, and nothing here is recomputed. A held row is precisely a
 * row restore will put back.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. A snapshot says "Ally captured your previous value for
 * this capability", not "Ally successfully applied its own". Those differ for a capability that
 * snapshotted and then failed. So the vocabulary here is HELD, never `applied` — this module does
 * not manufacture `ActionResult`s it never saw, and the screen must not present its output as
 * execution results (ADR-129).
 */

import type { Capability, CapabilityValue, DeviceSnapshot } from '../types';
import type { SnapshotStore } from './SnapshotStore';

/** One setting Ally borrowed, and the value that goes back when the context ends. */
export interface HeldSetting {
  capability: Capability;
  /** The user's own value, captured before Ally changed anything. Null when it was unreadable. */
  previousValue: CapabilityValue | null;
}

/**
 * The answer, plus whether it is an answer at all.
 *
 * `readable: false` is NOT an empty list. The distinction is the entire point: a store that cannot
 * be read is the same situation `unreadableRestore()` handles at the end of a session (ADR-117),
 * and collapsing it into "holding nothing" would reintroduce, by a different route, the exact lie
 * this module exists to remove.
 */
export interface HeldOutcome {
  readable: boolean;
  settings: HeldSetting[];
}

/**
 * Reads what Ally is holding for a session.
 *
 * Never throws. The caller is a screen refresh, and a snapshot store that rejects must not take
 * the UI down with it — it must produce `readable: false` so the screen can say so in words.
 */
export async function heldForSession(
  sessionId: string,
  snapshots: SnapshotStore,
): Promise<HeldOutcome> {
  let rows: DeviceSnapshot[];
  try {
    rows = await snapshots.forSession(sessionId);
  } catch {
    // Seen on device: expo-sqlite rejected a read while the DB was locked by another connection.
    return { readable: false, settings: [] };
  }

  return {
    readable: true,
    settings: rows.map((r) => ({ capability: r.capability, previousValue: r.previousValue })),
  };
}

/**
 * One plain sentence a person can act on.
 *
 * Written for the recovered case specifically, so it says why the detail is missing rather than
 * pretending the detail is "nothing". The three branches are three genuinely different situations
 * and none of them may be worded as any of the others.
 */
export function describeHeld(outcome: HeldOutcome): string {
  if (!outcome.readable) {
    return 'Ally cannot read what it is holding right now. Your settings have not been lost — end the context to put them back.';
  }
  if (outcome.settings.length === 0) {
    return 'Ally is not holding any of your settings.';
  }

  const names = outcome.settings.map((s) => s.capability).join(', ');
  return `Ally restarted, so the step-by-step results from this session are gone. What it is still holding is on record: ${names}. These go back when you end the context.`;
}
