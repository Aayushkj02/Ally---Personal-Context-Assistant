import { getDatabase } from '../database';
import { alarmRepository } from '../repositories/alarmRepository';
import { ensureSeeded } from '../seed';
import { startSession } from '../index';
import { activateFromText } from '../../services/contextOrchestrator';

beforeAll(async () => {
  // Ensure the database has the schema loaded (and test db clears automatically per setup)
  const db = await getDatabase();
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await ensureSeeded();
});

afterEach(async () => {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM alarm_metadata');
  await db.runAsync('DELETE FROM context_session');
});

describe('Phase 5 - Alarm Persistence', () => {
  it('persists alarm metadata linked to a session via repository', async () => {
    const session = await startSession({
      profileId: 'profile_sleep',
      now: Date.now(),
      durationMinutes: null,
    });

    await alarmRepository.createAlarmMetadata({
      id: 'alarm_test_1',
      sessionId: session.id,
      time: '07:30',
      recurrence: 'weekdays',
      createdAt: Date.now(),
    });

    const storedAlarms = await alarmRepository.getAlarmMetadataBySession(session.id);
    expect(storedAlarms).toHaveLength(1);
    expect(storedAlarms[0]!.time).toBe('07:30');
    expect(storedAlarms[0]!.recurrence).toBe('weekdays');
    expect(storedAlarms[0]!.sessionId).toBe(session.id);
  });

  it('cascades delete if session is removed', async () => {
    const session = await startSession({
      profileId: 'profile_sleep',
      now: Date.now(),
      durationMinutes: null,
    });

    await alarmRepository.createAlarmMetadata({
      id: 'alarm_test_2',
      sessionId: session.id,
      time: '08:00',
      recurrence: 'once',
      createdAt: Date.now(),
    });

    // Verify it exists
    let storedAlarms = await alarmRepository.getAlarmMetadataBySession(session.id);
    expect(storedAlarms).toHaveLength(1);

    // Delete session
    const db = await getDatabase();
    await db.runAsync('DELETE FROM context_session WHERE id = ?', [session.id]);

    // Verify alarm was deleted by CASCADE
    storedAlarms = await alarmRepository.getAlarmMetadataBySession(session.id);
    expect(storedAlarms).toHaveLength(0);
  });

  it('stores alarm intent through contextOrchestrator activateFromText', async () => {
    const outcome = await activateFromText('Wake me up at 7am on weekdays', {
      now: Date.now(),
      engine: {
        parse: async () => ({
          kind: 'intent',
          intent: {
            activity: 'sleep',
            operation: 'activate',
            durationMinutes: null,
            schedule: { kind: 'weekdays', time: '07:00' },
            persistence: 'session',
            requestedChanges: [],
            exceptions: [],
            confidence: 0.9,
            requiresConfirmation: false,
            rawText: 'Wake me up at 7am on weekdays',
            source: 'ollama',
          },
        }),
      },
    });

    expect(outcome.kind).toBe('activated');
    if (outcome.kind !== 'activated') return;

    // The alarm capability must be in the plan
    const alarmAction = outcome.plan.actions.find((a) => a.capability === 'alarm');
    expect(alarmAction).toBeDefined();
    expect(alarmAction?.value).toBe('07:00');
    expect(alarmAction?.needsSnapshot).toBe(false);

    // It must be persisted in DB
    const storedAlarms = await alarmRepository.getAlarmMetadataBySession(outcome.plan.sessionId);
    expect(storedAlarms).toHaveLength(1);
    expect(storedAlarms[0]!.time).toBe('07:00');
    expect(storedAlarms[0]!.recurrence).toBe('weekdays');
  });
});
