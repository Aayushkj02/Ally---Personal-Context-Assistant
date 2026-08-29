import { getDatabase } from '../../database';
import { 
  profileRepository, 
  sessionRepository, 
  overrideRepository, 
  snapshotRepository, 
  commandRepository, 
  permissionRepository 
} from '../index';
import type { 
  ContextProfile, Preference, TemporaryOverride, ContextSession, 
  DeviceSnapshot, CommandLog, ActionExecution, PermissionState 
} from '../../../types';

describe('Ally Phase 1 D1 Database and Repositories', () => {
  beforeAll(async () => {
    // getDatabase() inside tests will use the in-memory mocked sqlite database,
    // which automatically runs migrations (creates schema).
    await getDatabase();
  });

  const PROFILE_ID = 'prof_123';
  const PREF_ID = 'pref_123';
  const OVERRIDE_ID = 'over_123';
  const SESSION_ID = 'sess_123';
  const SNAPSHOT_ID = 'snap_123';
  const COMMAND_ID = 'cmd_123';
  const ACTION_ID = 'act_123';

  // Realistic Example Variables
  const sourceCommand = 'When I study, set brightness to 40%.';
  const previousBrightness = 72;
  const newBrightness = 40;

  describe('PROFILE & PREFERENCES', () => {
    it('1, 2. Create and retrieve a profile', async () => {
      const profile: ContextProfile = {
        id: PROFILE_ID,
        name: 'Study',
        modeKey: 'study',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await profileRepository.createProfile(profile);

      const retrieved = await profileRepository.getProfileById(PROFILE_ID);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Study');
    });

    it('3. Update the profile', async () => {
      const profile = await profileRepository.getProfileById(PROFILE_ID);
      expect(profile).toBeDefined();
      
      profile!.name = 'Deep Study';
      profile!.updatedAt = Date.now();
      await profileRepository.updateProfile(profile!);

      const updated = await profileRepository.getProfileById(PROFILE_ID);
      expect(updated?.name).toBe('Deep Study');
    });

    it('5, 6, 9. Save a preference, retrieve it, verify source_command preserved exactly', async () => {
      const pref: Preference = {
        id: PREF_ID,
        profileId: PROFILE_ID,
        capability: 'brightness',
        value: newBrightness,
        source: 'user',
        sourceCommand: sourceCommand,
        createdAt: Date.now(),
      };
      await profileRepository.createPreference(pref);

      const prefs = await profileRepository.getPreferencesByProfile(PROFILE_ID);
      expect(prefs.length).toBe(1);
      expect(prefs[0]!.value).toBe(newBrightness); // Verify number type remains number
      expect(prefs[0]!.sourceCommand).toBe(sourceCommand); // 9. source_command preserved
    });

    it('7. Update a preference', async () => {
      const prefs = await profileRepository.getPreferencesByProfile(PROFILE_ID);
      const pref = prefs[0]!;
      pref.value = 50;
      await profileRepository.updatePreference(pref);

      const updatedPrefs = await profileRepository.getPreferencesByProfile(PROFILE_ID);
      expect(updatedPrefs[0]!.value).toBe(50);
    });

    // 8. Delete preference will be tested implicitly if we clean up or we can test explicitly
    it('8. Delete a preference', async () => {
      await profileRepository.deletePreference(PREF_ID);
      const prefs = await profileRepository.getPreferencesByProfile(PROFILE_ID);
      expect(prefs.length).toBe(0);
    });
  });

  describe('TEMPORARY OVERRIDES', () => {
    it('10, 11, 12, 14. Create temporary override, retrieve active, verify expires_at, ensure it does not mutate pref', async () => {
      // Create a persistent pref first to prove it's untouched
      const pref: Preference = {
        id: 'pref_persistent',
        profileId: PROFILE_ID,
        capability: 'dnd',
        value: 'off',
        source: 'default',
        sourceCommand: null,
        createdAt: Date.now(),
      };
      await profileRepository.createPreference(pref);

      const expiresAt = Date.now() + 10000;
      const override: TemporaryOverride = {
        id: OVERRIDE_ID,
        profileId: PROFILE_ID,
        capability: 'dnd',
        value: 'priority',
        subject: null,
        effect: 'allow',
        startAt: Date.now(),
        expiresAt: expiresAt,
        active: true,
        sourceCommand: 'Turn on DND for 10 mins',
      };
      
      await overrideRepository.create(override);

      const activeOverrides = await overrideRepository.getActiveForProfile(PROFILE_ID);
      expect(activeOverrides.length).toBe(1);
      expect(activeOverrides[0]!.value).toBe('priority');
      expect(activeOverrides[0]!.expiresAt).toBe(expiresAt); // 12. Verify expires_at preserved

      // 14. Verify it does not mutate the persistent preference
      const prefs = await profileRepository.getPreferencesByProfile(PROFILE_ID);
      expect(prefs.find(p => p.id === 'pref_persistent')?.value).toBe('off');
    });

    it('13. Verify an expired override is not treated as active', async () => {
      // Create an override in the past
      const expiredOverride: TemporaryOverride = {
        id: 'over_expired',
        profileId: PROFILE_ID,
        capability: 'brightness',
        value: 10,
        subject: null,
        effect: 'allow',
        startAt: Date.now() - 20000,
        expiresAt: Date.now() - 10000,
        active: true,
        sourceCommand: null,
      };
      await overrideRepository.create(expiredOverride);

      const activeOverrides = await overrideRepository.getActiveForProfile(PROFILE_ID);
      // Should still only find the unexpired one from the previous test
      expect(activeOverrides.length).toBe(1);
      expect(activeOverrides.find(o => o.id === 'over_expired')).toBeUndefined();

      // Ensure identifyExpired finds it
      const expiredList = await overrideRepository.identifyExpired();
      expect(expiredList.find(o => o.id === 'over_expired')).toBeDefined();
    });
  });

  describe('SESSIONS & DEVICE SNAPSHOTS', () => {
    it('15, 16. Create context session, retrieve active session', async () => {
      const session: ContextSession = {
        id: SESSION_ID,
        profileId: PROFILE_ID,
        startedAt: Date.now(),
        endsAt: null,
        status: 'ACTIVE',
      };
      await sessionRepository.create(session);

      const active = await sessionRepository.getActive();
      expect(active).toBeDefined();
      expect(active?.id).toBe(SESSION_ID);
    });

    it('18, 19, 20. Store device snapshot, retrieve it, verify previous_value exactly', async () => {
      const snapshot: DeviceSnapshot = {
        id: SNAPSHOT_ID,
        sessionId: SESSION_ID,
        capability: 'brightness',
        previousValue: previousBrightness, // e.g. 72
        capturedAt: Date.now(),
      };
      await snapshotRepository.create(snapshot);

      const snaps = await snapshotRepository.getBySession(SESSION_ID);
      expect(snaps.length).toBe(1);
      // 20. Verify previous_value is preserved exactly
      expect(snaps[0]!.previousValue).toBe(previousBrightness);
    });

    it('17. End/update a session', async () => {
      await sessionRepository.endSession(SESSION_ID, 'IDLE', Date.now());
      const active = await sessionRepository.getActive();
      expect(active).toBeNull(); // Should no longer be active
    });
  });

  describe('AUDIT DATA', () => {
    it('21. Store a command log', async () => {
      const log: CommandLog = {
        id: COMMAND_ID,
        rawText: 'set brightness to 40%',
        intentJson: '{}',
        confidence: 0.95,
        source: 'ollama',
        createdAt: Date.now(),
      };
      await commandRepository.createCommand(log);

      const recent = await commandRepository.getRecentCommands(10);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent[0]!.rawText).toBe('set brightness to 40%');
    });

    it('22. Store an action execution', async () => {
      const action: ActionExecution = {
        id: ACTION_ID,
        commandId: COMMAND_ID,
        capability: 'brightness',
        status: 'applied',
        reason: 'User command',
        beforeValue: previousBrightness,
        afterValue: newBrightness,
      };
      await commandRepository.createAction(action);

      const actions = await commandRepository.getActionsByCommand(COMMAND_ID);
      expect(actions.length).toBe(1);
      expect(actions[0]!.beforeValue).toBe(previousBrightness);
    });
  });

  describe('PERMISSIONS', () => {
    it('23, 24. Store, retrieve, update permission state', async () => {
      const state: PermissionState = {
        key: 'write_settings',
        granted: false,
        checkedAt: Date.now(),
      };
      await permissionRepository.save(state);

      let retrieved = await permissionRepository.getByKey('write_settings');
      expect(retrieved?.granted).toBe(false);

      // Update
      state.granted = true;
      state.checkedAt = Date.now();
      await permissionRepository.save(state);

      retrieved = await permissionRepository.getByKey('write_settings');
      expect(retrieved?.granted).toBe(true);
    });
  });

  describe('PROFILE DELETION (CASCADE)', () => {
    it('4. Delete the profile (which should cascade delete related data if ON DELETE CASCADE works)', async () => {
      // Depending on sqlite3 foreign_keys PRAGMA in the mock, this might cascade.
      // But we just verify the profile itself is deleted.
      await profileRepository.deleteProfile(PROFILE_ID);
      const retrieved = await profileRepository.getProfileById(PROFILE_ID);
      expect(retrieved).toBeNull();
    });
  });
});
