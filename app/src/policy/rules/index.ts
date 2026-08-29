import { CAPABILITY_DOMAIN } from '../../types/capability';
import type { Capability, CapabilityValue } from '../../types/capability';
import type { Intent, RequestedChange } from '../../types/intent';
import type { Preference, TemporaryOverride } from '../../types/models';
import type { PreferenceSource, ResolvedEntry } from '../../types/policy';

/**
 * Validates a capability value against its defined domain to ensure safety.
 */
export function validatePolicyInput(capability: Capability, value: CapabilityValue): boolean {
  const domain = CAPABILITY_DOMAIN[capability];
  if (!domain) return false;

  if (domain.kind === 'enum') {
    return typeof value === 'string' && domain.values!.includes(value);
  }
  if (domain.kind === 'percent') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
  }
  if (domain.kind === 'time') {
    return typeof value === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value);
  }
  return false;
}

/**
 * Filter out overrides that have already expired.
 */
export function getActiveOverrides(

  overrides: TemporaryOverride[], 
  profileId: string | null,
  now: number = Date.now()
): TemporaryOverride[] {
  return overrides.filter(override => 
    override.active && 
    override.expiresAt > now &&
    (profileId === null || override.profileId === profileId)
  );
}

/**
 * Core precedence logic for a single capability.
 * Returns the highest precedence entry, its source, and a human-readable reason.
 */
export function resolveCapability(
  capability: Capability,
  intent: Intent,
  activeOverrides: TemporaryOverride[],
  preferences: Preference[],
  modeDefaults: Record<Capability, CapabilityValue>
): ResolvedEntry | null {
  // 1. Current Command
  const commandChanges = intent.requestedChanges.filter(c => c.capability === capability);
  if (commandChanges.length > 0) {
    const lastChange = commandChanges[commandChanges.length - 1]!;
    if (validatePolicyInput(capability, lastChange.value)) {
      return {
        capability,
        value: lastChange.value,
        source: 'command',
        reason: 'from your current command'
      };
    } else {
      throw new Error(`Invalid policy input for command capability: ${capability}`);
    }
  }

  // 2. Temporary Override
  const capOverrides = activeOverrides.filter(o => o.capability === capability && o.value !== null);
  if (capOverrides.length > 0) {
    const winningOverride = capOverrides.sort((a, b) => {
      if (a.expiresAt !== b.expiresAt) return b.expiresAt - a.expiresAt;
      return b.startAt - a.startAt;
    })[0]!;
    if (validatePolicyInput(capability, winningOverride.value!)) {
      return {
        capability,
        value: winningOverride.value!,
        source: 'override',
        reason: 'from a temporary override'
      };
    } else {
      throw new Error(`Invalid policy input for override capability: ${capability}`);
    }
  }

  // 3. Persistent Profile
  const profilePrefs = preferences.filter(p => p.capability === capability);
  if (profilePrefs.length > 0) {
    const winningPref = profilePrefs[profilePrefs.length - 1]!;
    if (validatePolicyInput(capability, winningPref.value)) {
      return {
        capability,
        value: winningPref.value,
        source: 'profile',
        reason: 'from your active profile'
      };
    } else {
      throw new Error(`Invalid policy input for profile capability: ${capability}`);
    }
  }

  // 4. Mode Default
  if (capability in modeDefaults) {
    const defaultVal = modeDefaults[capability]!;
    if (validatePolicyInput(capability, defaultVal)) {
      return {
        capability,
        value: defaultVal,
        source: 'default',
        reason: 'from system defaults'
      };
    } else {
      throw new Error(`Invalid policy input for default capability: ${capability}`);
    }
  }

  // Unsupported or untracked capability
  return null;
}
