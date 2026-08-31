import { useStore } from '../useStore';
import type { ActionPlan, ActionResult } from '../../types/policy';

describe('Ally D4 Runtime Store (Zustand)', () => {
  beforeEach(() => {
    // Force reset store before each test to guarantee isolation
    useStore.setState({
      sessionState: 'IDLE',
      activeProfileId: null,
      activeSessionId: null,
      currentTranscript: null,
      latestPlan: null,
      latestResults: [],
      error: null,
    });
  });

  it('1. Initial store state is valid', () => {
    const state = useStore.getState();
    expect(state.sessionState).toBe('IDLE');
    expect(state.activeProfileId).toBeNull();
    expect(state.activeSessionId).toBeNull();
    expect(state.latestPlan).toBeNull();
    expect(state.latestResults).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('10. Store does not require SQLite merely to initialize runtime state', () => {
    // Store is already initialized synchronously in memory at module import
    expect(useStore.getState()).toBeDefined();
  });

  it('2. Active context can be set', () => {
    useStore.getState().setActiveContext('prof_123', 'sess_456');
    const state = useStore.getState();
    expect(state.activeProfileId).toBe('prof_123');
    expect(state.activeSessionId).toBe('sess_456');
  });

  it('3. Active context can be cleared', () => {
    useStore.getState().setActiveContext('prof_123', 'sess_456');
    useStore.getState().clearActiveContext();
    const state = useStore.getState();
    expect(state.activeProfileId).toBeNull();
    expect(state.activeSessionId).toBeNull();
    expect(state.sessionState).toBe('IDLE');
  });

  it('4. Session information can be stored/updated (Transcript)', () => {
    useStore.getState().setTranscript('Hello Ally');
    expect(useStore.getState().currentTranscript).toBe('Hello Ally');
  });

  it('5. Processing/loading state can be changed (SessionState)', () => {
    useStore.getState().setSessionState('PARSING');
    expect(useStore.getState().sessionState).toBe('PARSING');

    useStore.getState().setSessionState('APPLYING');
    expect(useStore.getState().sessionState).toBe('APPLYING');
  });

  it('6. Latest result can be stored', () => {
    const mockPlan: ActionPlan = {
      sessionId: 'sess_1',
      actions: [],
      restoreOnEnd: true,
    };

    const mockResults: ActionResult[] = [
      {
        capability: 'brightness',
        status: 'applied',
        beforeValue: null,
        afterValue: 50,
        message: 'Set brightness to 50',
      },
    ];

    useStore.getState().setLatestPlan(mockPlan);
    useStore.getState().setLatestResults(mockResults);

    expect(useStore.getState().latestPlan).toEqual(mockPlan);
    expect(useStore.getState().latestResults).toEqual(mockResults);
  });

  it('7. Error state can be stored', () => {
    useStore.getState().setError('Failed to parse intent');
    expect(useStore.getState().error).toBe('Failed to parse intent');
  });

  it('8. Error state can be cleared', () => {
    useStore.getState().setError('Network Error');
    useStore.getState().clearError();
    expect(useStore.getState().error).toBeNull();
  });

  it('9. State transitions do not unexpectedly mutate unrelated state', () => {
    // Setup some baseline contextual state
    useStore.getState().setActiveContext('prof_999', 'sess_999');
    useStore.getState().setTranscript('Do something');

    // Act on an orthogonal piece of state
    useStore.getState().setError('Warning');

    // Verify baseline state remains perfectly untouched
    const state = useStore.getState();
    expect(state.activeProfileId).toBe('prof_999');
    expect(state.activeSessionId).toBe('sess_999');
    expect(state.currentTranscript).toBe('Do something');
    expect(state.error).toBe('Warning');

    // Verify `resetTransientState` accurately targets ONLY ephemeral artifacts
    useStore.getState().resetTransientState();
    const finalState = useStore.getState();
    expect(finalState.error).toBeNull();
    expect(finalState.currentTranscript).toBeNull();
    // These pointers MUST remain intact across transient resets
    expect(finalState.activeProfileId).toBe('prof_999');
    expect(finalState.activeSessionId).toBe('sess_999');
  });
});
