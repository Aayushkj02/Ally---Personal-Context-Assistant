import { create } from 'zustand';
import type { SessionState, ActionPlan, ActionResult } from '../types/policy';

export interface AppState {
  // --- Runtime UI / App State ---
  sessionState: SessionState;

  // Pointers to SQLite records, but not the heavy DB entities themselves
  activeProfileId: string | null;
  activeSessionId: string | null;

  // Ephemeral Assistant Context
  currentTranscript: string | null;
  latestPlan: ActionPlan | null;
  latestResults: ActionResult[];

  // Global Error State
  error: string | null;

  // --- Actions ---
  setSessionState: (state: SessionState) => void;

  setActiveContext: (profileId: string, sessionId: string) => void;
  clearActiveContext: () => void;

  /** Set either pointer on its own — a profile can be selected before a session exists. */
  setActiveProfileId: (profileId: string | null) => void;
  setActiveSessionId: (sessionId: string | null) => void;

  /**
   * End the running context in the UI: drops the session pointer and every per-run
   * value, but KEEPS activeProfileId, which is the user's standing choice of context.
   *
   * Runtime only. Nothing in SQLite is touched — ending a session for real is
   * endSession() in the memory layer (D-V7).
   */
  resetSession: () => void;

  setTranscript: (text: string) => void;

  setLatestPlan: (plan: ActionPlan) => void;
  setLatestResults: (results: ActionResult[]) => void;

  setError: (error: string) => void;
  clearError: () => void;

  resetTransientState: () => void;
}

export const useStore = create<AppState>((set) => ({
  // Initial State
  sessionState: 'IDLE',
  activeProfileId: null,
  activeSessionId: null,
  currentTranscript: null,
  latestPlan: null,
  latestResults: [],
  error: null,

  // Action Implementations
  setSessionState: (state) => set({ sessionState: state }),

  setActiveContext: (profileId, sessionId) =>
    set({
      activeProfileId: profileId,
      activeSessionId: sessionId,
    }),

  clearActiveContext: () =>
    set({
      activeProfileId: null,
      activeSessionId: null,
      sessionState: 'IDLE', // Safely revert to base lifecycle when clearing
    }),

  setActiveProfileId: (profileId) => set({ activeProfileId: profileId }),

  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),

  resetSession: () =>
    set({
      activeSessionId: null,
      sessionState: 'IDLE',
      currentTranscript: null,
      latestPlan: null,
      latestResults: [],
      error: null,
    }),

  setTranscript: (text) => set({ currentTranscript: text }),

  setLatestPlan: (plan) => set({ latestPlan: plan }),

  setLatestResults: (results) => set({ latestResults: results }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  resetTransientState: () =>
    set({
      currentTranscript: null,
      latestPlan: null,
      latestResults: [],
      error: null,
      sessionState: 'IDLE',
    }),
}));
