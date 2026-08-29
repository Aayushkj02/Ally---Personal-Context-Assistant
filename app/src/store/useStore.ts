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
  
  setActiveContext: (profileId, sessionId) => set({ 
    activeProfileId: profileId, 
    activeSessionId: sessionId 
  }),
  
  clearActiveContext: () => set({ 
    activeProfileId: null, 
    activeSessionId: null,
    sessionState: 'IDLE' // Safely revert to base lifecycle when clearing
  }),
  
  setTranscript: (text) => set({ currentTranscript: text }),
  
  setLatestPlan: (plan) => set({ latestPlan: plan }),
  
  setLatestResults: (results) => set({ latestResults: results }),
  
  setError: (error) => set({ error }),
  
  clearError: () => set({ error: null }),
  
  resetTransientState: () => set({
    currentTranscript: null,
    latestPlan: null,
    latestResults: [],
    error: null,
    sessionState: 'IDLE'
  })
}));
