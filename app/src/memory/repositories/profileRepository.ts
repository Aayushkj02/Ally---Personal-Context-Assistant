import { getDatabase } from '../database';
import type { ContextProfile, Preference, Capability, CapabilityValue } from '../../types';

function encodeValue(val: CapabilityValue): string {
  return JSON.stringify(val);
}

function decodeValue(val: string): CapabilityValue {
  return JSON.parse(val);
}

export const profileRepository = {
  async createProfile(profile: ContextProfile): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO context_profile (id, name, modeKey, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [profile.id, profile.name, profile.modeKey, profile.createdAt, profile.updatedAt],
    );
  },

  async getProfileById(id: string): Promise<ContextProfile | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContextProfile>(
      'SELECT id, name, modeKey, createdAt, updatedAt FROM context_profile WHERE id = ?',
      [id],
    );
    return row || null;
  },

  async getProfileByName(name: string): Promise<ContextProfile | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContextProfile>(
      'SELECT id, name, modeKey, createdAt, updatedAt FROM context_profile WHERE name = ?',
      [name],
    );
    return row || null;
  },

  /**
   * Look a profile up by its mode key ("study" | "sleep").
   *
   * This is the bridge from a validated Intent to stored memory: Intent.activity
   * carries the mode key, ContextProfile.modeKey stores it. Without this the
   * orchestrator would have to scan listProfiles() in application code.
   */
  async getProfileByModeKey(modeKey: string): Promise<ContextProfile | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContextProfile>(
      'SELECT id, name, modeKey, createdAt, updatedAt FROM context_profile WHERE modeKey = ?',
      [modeKey],
    );
    return row || null;
  },

  async listProfiles(): Promise<ContextProfile[]> {
    const db = await getDatabase();
    return await db.getAllAsync<ContextProfile>(
      'SELECT id, name, modeKey, createdAt, updatedAt FROM context_profile',
    );
  },

  async updateProfile(profile: ContextProfile): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE context_profile SET name = ?, modeKey = ?, updatedAt = ? WHERE id = ?',
      [profile.name, profile.modeKey, profile.updatedAt, profile.id],
    );
  },

  async deleteProfile(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM context_profile WHERE id = ?', [id]);
  },

  async createPreference(pref: Preference): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO preference (id, profileId, capability, value, source, sourceCommand, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        pref.id,
        pref.profileId,
        pref.capability,
        encodeValue(pref.value),
        pref.source,
        pref.sourceCommand,
        pref.createdAt,
      ],
    );
  },

  async getPreferencesByProfile(profileId: string): Promise<Preference[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>(
      'SELECT id, profileId, capability, value, source, sourceCommand, createdAt FROM preference WHERE profileId = ?',
      [profileId],
    );
    return rows.map((r) => ({
      ...r,
      value: decodeValue(r.value),
    }));
  },

  async updatePreference(pref: Preference): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE preference SET capability = ?, value = ?, source = ?, sourceCommand = ? WHERE id = ?',
      [pref.capability, encodeValue(pref.value), pref.source, pref.sourceCommand, pref.id],
    );
  },

  async deletePreference(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM preference WHERE id = ?', [id]);
  },
};
