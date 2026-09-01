/**
 * OWNER: DHREY — task D1, extracted in D-V3
 *
 * Seeds Study and Sleep on first run from src/modes/*.json (ADR-004).
 *
 * Lives in its own file rather than in index.ts so profileContext.ts can depend on it
 * without importing the barrel that exports profileContext — that would be a cycle.
 */

import { getModeDefinition, MODES } from '../modes';
import { getDatabase } from './database';
import { profileRepository } from './repositories';
import type { ContextProfile } from '../types/models';

/**
 * Create the profile row for each known mode if it does not exist yet.
 *
 * ONLY the context_profile row is seeded. The per-capability values in
 * src/modes/*.json are deliberately NOT written as `preference` rows: in the
 * precedence ladder (FLOW.md §4) mode files are the `default` tier, and the
 * policy engine already receives them through resolve()'s `modeDefaults`
 * argument. Persisting them as preferences would silently promote them to the
 * `profile` tier and break D2's precedence.
 *
 * Driven by MODES, so a third mode is seeded by adding data, not code (ADR-004).
 *
 * Idempotent — safe to call on every launch.
 */
export async function ensureSeeded(now: number = Date.now()): Promise<void> {
  await getDatabase();

  for (const modeKey of Object.keys(MODES)) {
    const existing = await profileRepository.getProfileByModeKey(modeKey);
    if (existing) continue;

    const definition = getModeDefinition(modeKey);
    if (!definition) continue;

    await profileRepository.createProfile({
      id: `profile_${modeKey}`,
      name: definition.name,
      modeKey: definition.modeKey as ContextProfile['modeKey'],
      createdAt: now,
      updatedAt: now,
    });
  }
}
