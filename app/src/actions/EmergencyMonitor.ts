/**
 * OWNER: AAYUSH — task A-V8
 *
 * Brings the EXISTING CallLogAnalyzer into the running application, and does nothing else.
 *
 * THE RULE IS NOT HERE. "Same caller, 4+ calls, rolling 10 minutes" lives in
 * CallLogAnalyzer.kt and is covered by its own JVM tests. This file parses what that returns
 * and hands it to the app in a typed shape. It does not count, threshold, window, or expire
 * anything — duplicating the rule in TypeScript would give the product two answers to the same
 * question, and the one the user sees would be the one nobody tested against a real call log.
 *
 * WHAT ALLY CAN AND CANNOT DO (ADR-109). Ally DETECTS the condition. Android decides whether a
 * call actually rings, through its own repeat-caller bypass, which uses a 15-minute window and
 * is not ours to set. So this reports "someone is trying hard to reach you" — never "we made
 * your phone ring". Those are different claims and only the first is true.
 *
 * EMERGENCY STATE IS CONTEXTUAL. It is computed on demand, tied to the session that asked, and
 * never written anywhere. It must not add the caller to Priority (that is a durable preference
 * the user did not make) and must not touch a DeviceSnapshot (that is the value restore depends
 * on). A detection is an observation about the last ten minutes, not a change to the phone.
 */

/** One caller's standing in the window, exactly as CallLogAnalyzer reports it. */
export interface EmergencyCaller {
  id: string;
  name: string | null;
  count: number;
  /** The analyzer's verdict, not ours — never recomputed from `count` here. */
  qualifies: boolean;
}

export interface EmergencyStatus {
  /** False when the call log could not be read at all. Never means "no emergency". */
  ok: boolean;
  /** Why the read failed: 'permission' | 'unsupported' | 'error'. Null when ok. */
  reason: string | null;
  /** The analyzer's own threshold verdict. */
  detected: boolean;
  callers: EmergencyCaller[];
  /** Ids that reached the threshold. */
  qualifyingCallers: string[];
  /**
   * Calls from withheld or unknown numbers. Counted, never merged into one caller — four
   * withheld calls are not evidence that one person called four times (ADR-109).
   */
  unidentifiedCalls: number;
  windowMinutes: number;
  threshold: number;
  /** Plain language for the user, from the analyzer. */
  message: string;
  /** The context this was evaluated for. Carried, never stored. */
  sessionId: string | null;
}

/** The native seam. Matches `analyseCallLog` in src/native, which returns null with no module. */
export type CallLogAnalyser = () => Record<string, unknown> | null;

export interface EmergencyDeps {
  analyse: CallLogAnalyser;
  /** Associates the reading with a running context. Purely informational. */
  sessionId?: string | null;
}

const UNAVAILABLE: Omit<EmergencyStatus, 'sessionId' | 'reason' | 'message'> = {
  ok: false,
  detected: false,
  callers: [],
  qualifyingCallers: [],
  unidentifiedCalls: 0,
  windowMinutes: 10,
  threshold: 4,
};

function toCallers(raw: unknown): EmergencyCaller[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== 'string') return [];

    return [
      {
        id: r.id,
        name: typeof r.name === 'string' ? r.name : null,
        count: typeof r.count === 'number' ? r.count : 0,
        // Taken from the analyzer, never derived from count >= threshold here.
        qualifies: r.qualifies === true,
      },
    ];
  });
}

/**
 * Reads the call log and reports whether anyone is trying hard to reach the user.
 *
 * Never throws. A missing permission, a missing native module or a query that blew up all come
 * back as `ok: false` with a reason — deliberately NOT as `detected: false`, because "we could
 * not look" and "we looked and nobody is calling" are different answers and the second one
 * would be a lie.
 */
export function evaluateEmergency(deps: EmergencyDeps): EmergencyStatus {
  const sessionId = deps.sessionId ?? null;

  let raw: Record<string, unknown> | null;
  try {
    raw = deps.analyse();
  } catch (e) {
    return {
      ...UNAVAILABLE,
      reason: 'error',
      message: e instanceof Error ? e.message : 'Ally could not read your call history.',
      sessionId,
    };
  }

  if (!raw) {
    return {
      ...UNAVAILABLE,
      reason: 'unsupported',
      message: 'Reading recent calls is not available on this device.',
      sessionId,
    };
  }

  if (raw.ok !== true) {
    return {
      ...UNAVAILABLE,
      reason: typeof raw.reason === 'string' ? raw.reason : 'error',
      message:
        typeof raw.message === 'string'
          ? raw.message
          : 'Ally could not read your call history just now.',
      sessionId,
    };
  }

  const callers = toCallers(raw.callers);

  return {
    ok: true,
    reason: null,
    // The analyzer's verdict. Not `callers.some(c => c.qualifies)` — one source of truth.
    detected: raw.thresholdMet === true,
    callers,
    qualifyingCallers: Array.isArray(raw.qualifyingCallers)
      ? raw.qualifyingCallers.filter((id): id is string => typeof id === 'string')
      : [],
    unidentifiedCalls: typeof raw.unidentifiedCalls === 'number' ? raw.unidentifiedCalls : 0,
    windowMinutes: typeof raw.windowMinutes === 'number' ? raw.windowMinutes : 10,
    threshold: typeof raw.threshold === 'number' ? raw.threshold : 4,
    message: typeof raw.message === 'string' ? raw.message : '',
    sessionId,
  };
}

/**
 * One line for the UI.
 *
 * Says what Ally observed, never what the phone will do. Whether a call actually breaks through
 * is Android's repeat-caller setting, which we do not control.
 */
export function describeEmergency(status: EmergencyStatus): string {
  if (!status.ok) return status.message;
  if (!status.detected) return status.message;

  const named = status.callers
    .filter((c) => c.qualifies)
    .map((c) => c.name ?? c.id)
    .join(', ');

  return `${named} has called ${status.threshold}+ times in ${status.windowMinutes} minutes. Android decides whether that rings through.`;
}
