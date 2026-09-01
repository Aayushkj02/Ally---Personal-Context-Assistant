import { getDatabase } from '../../database';
import { ensureSeeded } from '../../index';
import { profileRepository } from '../profileRepository';
import type { Preference } from '../../../types';

const STUDY = 'profile_study';
const SLEEP = 'profile_sleep';

function pref(over: Partial<Preference>): Preference {
  return {
    id: `pref_${Math.random().toString(36).slice(2, 10)}`,
    profileId: STUDY,
    capability: 'brightness',
    value: 50,
    source: 'user',
    sourceCommand: 'keep brightness at 50',
    createdAt: Date.now(),
    ...over,
  };
}

async function rawRows(profileId: string) {
  const db = await getDatabase();
  return db.getAllAsync<{
    id: string;
    profileId: string;
    capability: string;
    value: string;
    sourceCommand: string | null;
  }>('SELECT id, profileId, capability, value, sourceCommand FROM preference WHERE profileId = ?', [
    profileId,
  ]);
}

describe('D4.1 Preference Uniqueness and UPSERT', () => {
  beforeAll(async () => {
    await getDatabase();
    await ensureSeeded();
  });

  afterEach(async () => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM preference');
  });

  // TEST 1 — Repeated natural-key writes do not duplicate
  it('D41-1: Repeated natural-key writes do not duplicate', async () => {
    const p1 = pref({ id: 'id1', value: 40 });
    const p2 = pref({ id: 'id2', value: 30 });

    await profileRepository.createPreference(p1);
    await profileRepository.createPreference(p2);

    const rows = await rawRows(STUDY);
    expect(rows).toHaveLength(1);
  });

  // TEST 2 — Last write wins
  it('D41-2: Last write wins semantics', async () => {
    const p1 = pref({ id: 'id1', value: 40, sourceCommand: 'original' });
    const p2 = pref({ id: 'id2', value: 30, sourceCommand: 'updated' });

    await profileRepository.createPreference(p1);
    await profileRepository.createPreference(p2);

    const rows = await rawRows(STUDY);
    expect(rows[0]!.value).toBe('30');
    expect(rows[0]!.sourceCommand).toBe('updated');
  });

  // TEST 3 — Existing ID stability
  it('D41-3: Existing ID stability on UPSERT conflict', async () => {
    const p1 = pref({ id: 'id1', value: 40 });
    const p2 = pref({ id: 'id2', value: 30 });

    await profileRepository.createPreference(p1);
    await profileRepository.createPreference(p2);

    const rows = await rawRows(STUDY);
    // The id from the original row should be preserved
    expect(rows[0]!.id).toBe('id1');
  });

  // TEST 4 — Different capabilities remain independent
  it('D41-4: Different capabilities remain independent', async () => {
    await profileRepository.createPreference(pref({ capability: 'brightness' }));
    await profileRepository.createPreference(pref({ capability: 'dnd' }));

    const rows = await rawRows(STUDY);
    expect(rows).toHaveLength(2);
  });

  // TEST 5 — Different profiles remain independent
  it('D41-5: Different profiles remain independent', async () => {
    await profileRepository.createPreference(pref({ profileId: STUDY }));
    await profileRepository.createPreference(pref({ profileId: SLEEP }));

    expect(await rawRows(STUDY)).toHaveLength(1);
    expect(await rawRows(SLEEP)).toHaveLength(1);
  });

  // TEST 6 — Deterministic reads
  it('D41-6: Deterministic reads ordering', async () => {
    const db = await getDatabase();

    // Insert bypassing repository to guarantee creation order independent of UPSERTs
    await db.runAsync(
      'INSERT INTO preference (id, profileId, capability, value, source, sourceCommand, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['p2', STUDY, 'dnd', '"off"', 'user', null, 2000]
    );
    await db.runAsync(
      'INSERT INTO preference (id, profileId, capability, value, source, sourceCommand, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['p1', STUDY, 'brightness', '50', 'user', null, 1000]
    );

    const list = await profileRepository.getPreferencesByProfile(STUDY);

    // Should be ordered by createdAt ASC
    expect(list[0]!.id).toBe('p1');
    expect(list[1]!.id).toBe('p2');
  });

  // TEST 7 — Database-level uniqueness
  it('D41-7: Database-level uniqueness rejects duplicate natural keys', async () => {
    const db = await getDatabase();

    await db.runAsync(
      'INSERT INTO preference (id, profileId, capability, value, source, sourceCommand, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['id1', STUDY, 'brightness', '40', 'user', null, 1000]
    );

    // Raw insert bypassing ON CONFLICT should throw
    await expect(
      db.runAsync(
        'INSERT INTO preference (id, profileId, capability, value, source, sourceCommand, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', STUDY, 'brightness', '30', 'user', null, 2000]
      )
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});
