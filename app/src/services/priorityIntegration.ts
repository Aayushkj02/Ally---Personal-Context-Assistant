/**
 * OWNER: DHREY — task D-V5 (Priority Integration)
 *
 * Connects the stored priority list to the device, and reports honestly what happened:
 *
 *   memory (D-V3) → resolvePriority (D-V2) → native request → ChannelEnforcement[]
 *
 * This is the first consumer of ResolvedPriority. It lives in services/ rather than
 * policy/ because it performs I/O — a database read and a native call — and
 * `src/policy/` must stay pure and device-free.
 *
 * TWO SAFETY INVARIANTS ARE ENCODED IN THE TYPES, NOT LEFT TO CARE:
 *
 * 1. WHATSAPP IS NEVER SENT TO ANDROID (ADR-111). `PriorityRequest` has no whatsapp
 *    field at all, so there is no expression in this module that could ask Android to
 *    enforce it. It remains stored, and reported as `preference_only`.
 *
 * 2. THE REPEAT-CALLER BYPASS IS NEVER TURNED OFF (ADR-109). `repeatCallers` is typed
 *    as the literal `true`, so a request that suppresses Android's safety net for
 *    persistent callers does not typecheck. Ordinary priority rules cannot narrow it.
 *
 * NOTE ON "EMERGENCY CALLS" (ADR-109): there is no emergency channel, and this module
 * does not invent one. The safety net is Android's own PRIORITY_CATEGORY_REPEAT_CALLERS
 * (invariant 2 above). Detection of the 4-calls-in-10-minutes rule is CallLogAnalyzer,
 * which reports and never rings. ADR-109 is explicit that the two must never be
 * conflated, so this module touches only the bypass.
 */

import { loadProfileContext } from '../memory';
import { describeEnforcement, resolvePriority, type ResolvedPriority } from '../policy';
import { CHANNEL_ENFORCEABLE } from '../types';
import type { Channel, ChannelEnforcement, ContextProfile, PriorityPreference } from '../types';

/**
 * What we ask Android for.
 *
 * No whatsapp field (invariant 1). `repeatCallers` is literally `true` (invariant 2).
 */
export interface PriorityRequest {
  calls: boolean;
  sms: boolean;
  repeatCallers: true;
}

/** The native seam. Matches `applyPriorityPreferences` in src/native. */
export type PriorityApplier = (prefs: {
  calls: boolean;
  sms: boolean;
  repeatCallers?: boolean;
}) => { ok: boolean; channels: ChannelEnforcement[] } | null;

export interface PriorityOutcome {
  profileId: string;
  profile: ContextProfile;
  /** What the user asked for, per channel. */
  resolved: ResolvedPriority;
  /** What was actually sent to the device layer. */
  request: PriorityRequest;
  /** One row per channel, in the four-state vocabulary. */
  enforcement: ChannelEnforcement[];
  /** The stored rows this was built from — for the Memory screen's provenance. */
  preferences: PriorityPreference[];
}

export interface PriorityDeps {
  /** Defaults to the real native seam, which returns null when there is no device. */
  applier?: PriorityApplier;
  now?: number;
}

const ALL_CHANNELS: Channel[] = ['calls', 'sms', 'whatsapp'];

/**
 * ResolvedPriority → the native request.
 *
 * Pure and total: every ResolvedPriority maps to exactly one request, and the emergency
 * bypass is on in all of them.
 */
export function buildPriorityRequest(resolved: ResolvedPriority): PriorityRequest {
  return {
    calls: resolved.channels.calls,
    sms: resolved.channels.sms,
    repeatCallers: true,
  };
}

/** Channels the user enabled that Android can actually act on. */
function requestedEnforceableChannels(resolved: ResolvedPriority): Channel[] {
  return ALL_CHANNELS.filter((c) => CHANNEL_ENFORCEABLE[c] && resolved.channels[c]);
}

/**
 * No native module at all — an emulator, Expo Go, or a Node process. We never attempted
 * anything, so this is `unsupported`, not `failed` (ADR-113).
 */
function noDeviceReport(resolved: ResolvedPriority): ChannelEnforcement[] {
  const rows = requestedEnforceableChannels(resolved).map((channel) => ({
    channel,
    status: 'unsupported' as const,
    message: 'This device cannot apply priority settings.',
  }));
  return describeEnforcement(resolved, rows);
}

/** The device was there and the attempt did not hold. Never reported as enforced. */
function attemptFailedReport(resolved: ResolvedPriority, message: string): ChannelEnforcement[] {
  const rows = requestedEnforceableChannels(resolved).map((channel) => ({
    channel,
    status: 'failed' as const,
    message,
  }));
  return describeEnforcement(resolved, rows);
}

/**
 * Resolve a profile's priority list and apply it, returning the honest per-channel result.
 *
 * Returns null when the activity does not map to a stored profile, mirroring
 * loadProfileContext so a caller can clarify rather than act on nothing.
 */
export async function applyPriorityForActivity(
  activity: string,
  deps: PriorityDeps = {},
): Promise<PriorityOutcome | null> {
  const context = await loadProfileContext(activity, { now: deps.now });
  if (!context) {
    return null;
  }

  return applyPriorityForContext(context.profile, context.priorityPreferences, deps);
}

/**
 * Same, for a profile and its stored rows already in hand.
 *
 * Split out so the resolution and reporting are testable without touching SQLite, and
 * so a screen that already loaded its context does not read it twice.
 */
export async function applyPriorityForContext(
  profile: ContextProfile,
  preferences: PriorityPreference[],
  deps: PriorityDeps = {},
): Promise<PriorityOutcome> {
  const resolved = resolvePriority(profile.id, preferences);
  const request = buildPriorityRequest(resolved);

  const applier = deps.applier ?? (await defaultApplier());

  let enforcement: ChannelEnforcement[];

  if (!applier) {
    enforcement = noDeviceReport(resolved);
  } else {
    try {
      const result = applier(request);
      if (!result) {
        // The seam itself reports "no native module".
        enforcement = noDeviceReport(resolved);
      } else {
        // The device's own rows win. describeEnforcement fills any channel it did not
        // mention, and can never turn silence into `enforced`.
        enforcement = describeEnforcement(resolved, result.channels);
      }
    } catch {
      enforcement = attemptFailedReport(resolved, 'Ally could not confirm this with Android.');
    }
  }

  return {
    profileId: profile.id,
    profile,
    resolved,
    request,
    enforcement,
    preferences,
  };
}

/**
 * The production seam, loaded lazily.
 *
 * src/native reaches across the Expo bridge at import time; importing it eagerly would
 * drag that into every consumer of this module. It returns null with no native module
 * present, which is the documented signal for "no device" (ADR-007).
 */
async function defaultApplier(): Promise<PriorityApplier | null> {
  try {
    const native = await import('../native');
    return native.applyPriorityPreferences;
  } catch {
    return null;
  }
}
