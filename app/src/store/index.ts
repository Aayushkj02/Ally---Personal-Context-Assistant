/**
 * OWNER: DHREY. FREEZE once Phase 1 closes.
 *
 * Session/app state. Deliberately thin: priority preferences live in SQLite and are read
 * through the repository, never mirrored here. The store holds only which mode the user is
 * looking at and the last enforcement result — UI state, not data.
 */

import { create } from 'zustand';

import type { ChannelEnforcement } from '../types';

/** The three contexts. Study and Sleep are seeded; Focus is scaffolded (ADR-004). */
export const MODES = [
  { id: 'study', label: 'Study' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'focus', label: 'Focus' },
] as const;

export type ModeId = (typeof MODES)[number]['id'];

interface AppState {
  mode: ModeId;
  setMode: (mode: ModeId) => void;
  lastEnforcement: ChannelEnforcement[] | null;
  setLastEnforcement: (rows: ChannelEnforcement[] | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'sleep',
  setMode: (mode) => set({ mode, lastEnforcement: null }),
  lastEnforcement: null,
  setLastEnforcement: (rows) => set({ lastEnforcement: rows }),
}));
