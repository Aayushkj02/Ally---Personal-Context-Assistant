/**
 * OWNER: DHREY — task D-V3 (Profile / Memory Lookup)
 *
 * Resolves an activity to its stored profile and gathers everything the policy engine
 * needs in one read. This is the memory half of the vertical slice:
 *
 *   validated Intent → activity → profile → { preferences, priority, overrides, session }
 *                                                        ↓
 *                                               PolicyEngine.resolve()
 *
 * RETRIEVAL ONLY. Nothing here decides anything. Which preference wins, whether an
 * override beats a profile value, when something expires — all of that stays in D2's
 * resolver (FLOW.md §4). Memory fetches; policy decides. Putting precedence in here
 * would make the same question answerable in two places, which is how the two answers
 * start to disagree.
 *
 * MODE-AGNOSTIC BY CONSTRUCTION (ADR-004). The lookup is driven by `modeKey`, never by
 * a hardcoded study/sleep branch, so adding a third mode stays "data, not code" exactly
 * as ADR-004 requires: seed a row, add a mode file, and this module resolves it with no
 * change here.
 */

import { getModeDefinition, MODES } from '../modes';
import type {
  ContextProfile,
  ContextSession,
  DeviceSnapshot,
  Preference,
  PriorityPreference,
  TemporaryOverride,
} from '../types';
import { ensureSeeded } from './seed';
import {
  overrideRepository,
  priorityRepository,
  profileRepository,
  sessionRepository,
  snapshotRepository,
} from './repositories';

/**
 * Everything policy needs about one context, read in a single pass.
 *
 * A carrier over the existing frozen row types — not a new domain model. Nothing here
 * redefines ContextProfile, Preference, PriorityPreference, TemporaryOverride,
 * ContextSession or DeviceSnapshot.
 */
export interface ProfileContext {
  profile: ContextProfile;
  /** Persistent per-capability preferences for this profile. */
  preferences: Preference[];
  /** Standing per-channel priority list for this profile (D-V2). */
  priorityPreferences: PriorityPreference[];
  /** ACTIVE overrides only — expired rows are filtered out at read time. */
  overrides: TemporaryOverride[];
  /** The open session for THIS profile, or null when no context is running. */
  session: ContextSession | null;
  /** Snapshots belonging to that session. Empty when there is no session. */
  snapshots: DeviceSnapshot[];
}

export interface LookupOptions {
  /** Injectable clock. */
  now?: number;
  /** Seed Study/Sleep before looking up. Default true. */
  seed?: boolean;
}

/**
 * activity → the stored ContextProfile that owns it.
 *
 * Driven entirely by `modeKey`. `getModeDefinition` normalises case and whitespace, so
 * "Study" and " study " resolve like "study". An activity with no mode definition — or
 * with a definition but no seeded row — returns null rather than a guess.
 */
export async function resolveProfileForActivity(
  activity: string,
  options: LookupOptions = {},
): Promise<ContextProfile | null> {
  const definition = getModeDefinition(activity);
  if (!definition) {
    return null;
  }

  if (options.seed !== false) {
    await ensureSeeded(options.now);
  }

  return profileRepository.getProfileByModeKey(definition.modeKey);
}

/**
 * Load the full context for an activity.
 *
 * Returns null when the activity does not map to a stored profile, so a caller can ask
 * for clarification instead of resolving policy against nothing.
 */
export async function loadProfileContext(
  activity: string,
  options: LookupOptions = {},
): Promise<ProfileContext | null> {
  const profile = await resolveProfileForActivity(activity, options);
  if (!profile) {
    return null;
  }

  return loadContextForProfile(profile);
}

/**
 * Same aggregation, for a profile already in hand.
 *
 * Split out so a screen that knows its profile does not re-resolve it, and so the
 * activity lookup and the loading are independently testable.
 */
export async function loadContextForProfile(profile: ContextProfile): Promise<ProfileContext> {
  const [preferences, priorityPreferences, overrides] = await Promise.all([
    profileRepository.getPreferencesByProfile(profile.id),
    priorityRepository.listForProfile(profile.id),
    overrideRepository.getActiveForProfile(profile.id),
  ]);

  // getActive() is global — the open session might belong to another mode. Attaching it
  // regardless would tell policy that Sleep's session is Study's.
  const openSession = await sessionRepository.getActive();
  const session = openSession && openSession.profileId === profile.id ? openSession : null;

  const snapshots = session ? await snapshotRepository.getBySession(session.id) : [];

  return { profile, preferences, priorityPreferences, overrides, session, snapshots };
}

/** The activities that currently resolve to a profile. Derived from the mode files. */
export function knownActivities(): string[] {
  return Object.keys(MODES);
}
