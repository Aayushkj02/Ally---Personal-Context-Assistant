/**
 * OWNER: DHREY — task D3.4 (Temporary Overrides)
 *
 * Creating and reading temporary overrides, over the EXISTING temporary_override table
 * and overrideRepository. No second override store, no second expiry mechanism.
 *
 *   "dim it to 40 for two hours"
 *        → createTemporaryOverride({ durationMinutes: 120 })
 *        → expiresAt = startAt + 120 × 60_000        (stored, absolute)
 *        → policy sees it until that instant, and never again
 *
 * EXPIRY IS A QUERY, NOT AN EVENT. Nothing is deleted, no timer is set, no background
 * job runs. Whether an override counts is decided from stored timestamps against the
 * clock at read time — which is why an app closed at 17:00 and reopened at 20:00 sees
 * an 18:00 override as expired the instant it looks, with no catch-up work.
 *
 * `isOverrideActive` (policy/rules) is the single definition of "in force". This module
 * does not restate it, so the repository's SQL filter and the policy resolver cannot
 * drift apart.
 */

import type { Capability, CapabilityValue, TemporaryOverride } from '../types';
import { overrideRepository } from './repositories';

export interface CreateOverrideInput {
  profileId: string;
  /** null when the override is purely a contact/subject exception. */
  capability: Capability | null;
  value: CapabilityValue | null;
  /** "project group", "Rahul" — as the user said it. */
  subject?: string | null;
  effect?: 'allow' | 'block';
  /** The verbatim sentence behind this override, for the Memory screen. */
  sourceCommand?: string | null;
  /** When the override begins. Defaults to now. */
  now?: number;
  /**
   * EXACTLY ONE of these is required.
   *
   * There is deliberately no fallback: an override with no stated end is a permanent
   * preference wearing the wrong hat, and guessing a duration would silently decide
   * something the user did not say.
   */
  expiresAt?: number;
  durationMinutes?: number;
}

/**
 * Persist a temporary override with an absolute expiry.
 *
 * A duration is converted once, here, into a stored `expiresAt`. Keeping the absolute
 * instant rather than the duration is what makes expiry survive the process dying: there
 * is no "started counting at" state to reconstruct on the next launch.
 */
export async function createTemporaryOverride(
  input: CreateOverrideInput,
): Promise<TemporaryOverride> {
  const startAt = input.now ?? Date.now();

  const hasExplicit = input.expiresAt !== undefined;
  const hasDuration = input.durationMinutes !== undefined;

  if (hasExplicit === hasDuration) {
    throw new Error(
      'A temporary override needs exactly one of expiresAt or durationMinutes — ' +
        'an override with no stated end is a persistent preference, not a temporary one.',
    );
  }

  const expiresAt = hasExplicit ? input.expiresAt! : startAt + input.durationMinutes! * 60_000;

  const override: TemporaryOverride = {
    id: `ovr_${startAt.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    profileId: input.profileId,
    capability: input.capability,
    value: input.value,
    subject: input.subject ?? null,
    effect: input.effect ?? 'allow',
    startAt,
    expiresAt,
    active: true,
    sourceCommand: input.sourceCommand ?? null,
  };

  await overrideRepository.create(override);
  return override;
}

/**
 * Overrides in force for a profile at `now`.
 *
 * Delegates to the repository's SQL filter, which mirrors `isOverrideActive`.
 */
export async function listActiveOverrides(
  profileId: string,
  now: number = Date.now(),
): Promise<TemporaryOverride[]> {
  return overrideRepository.getActiveForProfile(profileId, now);
}

/**
 * Every override ever recorded for a profile, expired ones included.
 *
 * Expiry does not erase history: a lapsed override is still the reason the phone behaved
 * a certain way for two hours, and the Memory screen needs to be able to say so.
 */
export async function listOverrideHistory(profileId: string): Promise<TemporaryOverride[]> {
  return overrideRepository.listForProfile(profileId);
}

/**
 * End an override early, before its expiry.
 *
 * Sets `active = 0` rather than deleting, so "let the group through for 20 minutes —
 * actually, never mind" leaves a record of both halves.
 */
export async function deactivateOverride(id: string): Promise<void> {
  await overrideRepository.markInactive(id);
}
