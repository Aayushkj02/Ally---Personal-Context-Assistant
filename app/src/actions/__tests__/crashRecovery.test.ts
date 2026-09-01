import { createRepositorySnapshotStore, endContext } from '../index';
import { getDatabase } from '../../memory/database';
import { sessionRepository } from '../../memory/repositories';
import { runMigrations } from '../../memory/migrations';
import type { ContextSession } from '../../types/models';
import type { LifecycleHooks } from '../ContextCoordinator';
import type { DeviceRegistry, DeviceCapability } from '../../types/device';

function createMockRegistry(): DeviceRegistry {
  const map: Record<string, DeviceCapability> = {
    brightness: {
      isAvailable: async () => true,
      requiredPermissions: async () => [],
      snapshot: async () => 50,
      execute: async (value: any) => ({
        capability: 'brightness',
        status: 'applied',
        beforeValue: 50,
        afterValue: value,
        message: 'Applied',
      }),
      restore: async (value: any) => ({
        capability: 'brightness',
        status: 'restored',
        beforeValue: 40,
        afterValue: value,
        message: 'Restored',
      }),
    } as any,
  };
  return {
    backend: 'mock',
    get: (capability) => map[capability as string] || map.brightness!,
    openSettingsFor: async () => {},
  };
}

describe('D7.3 Context Crash / Restart Recovery', () => {
  let db: any;
  let hooks: jest.Mocked<LifecycleHooks>;
  let snapshots: any;

  beforeAll(async () => {
    db = await getDatabase();
    await runMigrations(db);
  });

  beforeEach(async () => {
    await db.runAsync('DELETE FROM context_session');
    await db.runAsync('DELETE FROM device_snapshot');

    hooks = {
      onStarted: jest.fn(),
      onActivated: jest.fn(),
      onFailed: jest.fn(),
      onPartial: jest.fn(),
      onEnded: jest.fn(),
    };

    snapshots = createRepositorySnapshotStore();
  });

  it('safely recovers and restores a session that was active during a crash', async () => {
    // 0. Insert profile
    await db.runAsync(
      'INSERT OR IGNORE INTO context_profile (id, name, modeKey, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      ['prof_test', 'Test Profile', 'study', Date.now(), Date.now()]
    );

    const sessionId = 'session_crash_123';
    const activeSession: ContextSession = {
      id: sessionId,
      profileId: 'prof_test',
      startedAt: Date.now() - 5000,
      endsAt: Date.now() + 5000,
      status: 'ACTIVE',
    };
    await sessionRepository.create(activeSession);

    await snapshots.save({ id: 'snap_1', sessionId, capability: 'brightness', previousValue: 40, capturedAt: Date.now() });
    await snapshots.save({ id: 'snap_2', sessionId, capability: 'dnd', previousValue: 'off', capturedAt: Date.now() });

    const recoveredSession = await sessionRepository.getActive();
    expect(recoveredSession).not.toBeNull();
    expect(recoveredSession?.id).toBe(sessionId);

    // Spy on the registry to verify restores
    const registry = createMockRegistry();
    const restoreSpy = jest.spyOn(registry.get('brightness'), 'restore');

    const result = await endContext(recoveredSession!.id, {
      registry,
      snapshots,
      hooks,
      policy: null as any,
    });

    expect(restoreSpy).toHaveBeenCalledWith(40);
    expect(result.state).toBe('IDLE');
    expect(hooks.onEnded).toHaveBeenCalledWith(sessionId, 'IDLE');
  });

  it('does not restore if no snapshot exists', async () => {
    // 0. Insert profile
    await db.runAsync(
      'INSERT OR IGNORE INTO context_profile (id, name, modeKey, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      ['prof_test', 'Test Profile', 'study', Date.now(), Date.now()]
    );

    const sessionId = 'session_no_snap';
    await sessionRepository.create({
      id: sessionId,
      profileId: 'prof_test',
      startedAt: Date.now() - 5000,
      endsAt: Date.now() + 5000,
      status: 'ACTIVE',
    });

    const recoveredSession = await sessionRepository.getActive();
    expect(recoveredSession?.id).toBe(sessionId);

    const registry = createMockRegistry();
    const restoreSpy = jest.spyOn(registry.get('brightness'), 'restore');

    const result = await endContext(recoveredSession!.id, {
      registry,
      snapshots,
      hooks,
      policy: null as any,
    });

    // Should not call restore since there is no snapshot
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(result.state).toBe('IDLE');
  });
});
