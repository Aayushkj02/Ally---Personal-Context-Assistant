import { profileRepository, priorityRepository } from '../memory/repositories';
import type { Preference, PriorityPreference } from '../types';

export interface MemoryQueryResult {
  capabilities: Preference[];
  priorities: PriorityPreference[];
}

export const memoryQueryService = {
  /**
   * Retrieves all persistent memory for a given profile.
   * Empty memory is safe and returns empty collections.
   */
  async queryProfileMemory(profileId: string): Promise<MemoryQueryResult> {
    const capabilities = await profileRepository.getPreferencesByProfile(profileId);
    const priorities = await priorityRepository.listForProfile(profileId);

    return {
      capabilities,
      priorities,
    };
  },
};
