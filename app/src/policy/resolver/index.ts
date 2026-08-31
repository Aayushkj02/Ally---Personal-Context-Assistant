import { CAPABILITIES } from '../../types/capability';
import type { Capability, CapabilityValue } from '../../types/capability';
import type { Intent, IntentException } from '../../types/intent';
import type { ContextProfile, Preference, TemporaryOverride } from '../../types/models';
import type { ResolvedPolicy, ResolvedEntry, ResolvedException } from '../../types/policy';
import { getActiveOverrides, resolveCapability } from '../rules';

/**
 * Resolves contact/subject exceptions from the current intent and active overrides.
 */
function resolveExceptions(
  intent: Intent,
  activeOverrides: TemporaryOverride[],
  now: number,
): ResolvedException[] {
  const exceptions: ResolvedException[] = [];

  // Add intent exceptions (highest precedence implicitly because they are current)
  for (const exc of intent.exceptions) {
    exceptions.push({
      subject: exc.value,
      effect: exc.effect,
      expiresAt: exc.durationMinutes ? now + exc.durationMinutes * 60000 : null,
      source: 'command',
    });
  }

  // Add override exceptions
  for (const override of activeOverrides) {
    if (override.subject) {
      // Avoid adding if the intent already handled this exact subject
      if (!exceptions.some((e) => e.subject.toLowerCase() === override.subject!.toLowerCase())) {
        exceptions.push({
          subject: override.subject,
          effect: override.effect,
          expiresAt: override.expiresAt,
          source: 'override',
        });
      }
    }
  }

  return exceptions;
}

/**
 * PolicyEngine.resolve() — pure TypeScript, ZERO I/O.
 *   resolve(intent, profile, overrides, modeDefaults) -> ResolvedPolicy
 */
export function resolve(
  intent: Intent,
  profile: ContextProfile | null,
  preferences: Preference[],
  overrides: TemporaryOverride[],
  modeDefaults: Record<Capability, CapabilityValue>,
  now: number = Date.now(),
): ResolvedPolicy {
  const activeOverrides = getActiveOverrides(overrides, profile ? profile.id : null, now);
  const entries: ResolvedEntry[] = [];

  // Resolve each capability in the allow-list
  for (const cap of CAPABILITIES) {
    const entry = resolveCapability(cap, intent, activeOverrides, preferences, modeDefaults);
    if (entry) {
      entries.push(entry);
    }
  }

  const exceptions = resolveExceptions(intent, activeOverrides, now);

  return {
    activity: profile ? profile.name : intent.activity,
    profileId: profile ? profile.id : 'default',
    durationMinutes: intent.durationMinutes,
    entries,
    exceptions,
  };
}
