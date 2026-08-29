/**
 * OWNER: SHARED — FROZEN after the Day 1 contract PR.
 * Row shapes for the SQLite tables in docs/CONTRACTS.md §5.
 * Dhrey's repositories return these; everyone else consumes them read-only.
 */

import type { Capability, CapabilityValue } from './capability';
import type { ActionStatus, SessionState } from './policy';
import type { Persistence } from './intent';

export interface ContextProfile {
  id: string;
  name: string;
  /** Links the profile to its declarative defaults in src/modes/<modeKey>.json */
  modeKey: 'study' | 'sleep';
  createdAt: number;
  updatedAt: number;
}

export interface Preference {
  id: string;
  profileId: string;
  capability: Capability;
  value: CapabilityValue;
  source: 'user' | 'default';
  /**
   * The verbatim command that created this preference.
   * Powers the Memory screen: "because you said '…' on Aug 29".
   * This provenance is the novelty argument — do not drop it.
   */
  sourceCommand: string | null;
  createdAt: number;
}

export interface TemporaryOverride {
  id: string;
  profileId: string;
  /** null when the override is purely a contact exception. */
  capability: Capability | null;
  value: CapabilityValue | null;
  /** "project group", "Rahul" — as the user said it. */
  subject: string | null;
  effect: 'allow' | 'block';
  startAt: number;
  expiresAt: number;
  active: boolean;
  sourceCommand: string | null;
}

export interface ContextSession {
  id: string;
  profileId: string;
  startedAt: number;
  /** null for open-ended sessions. */
  endsAt: number | null;
  status: SessionState;
}

export interface DeviceSnapshot {
  id: string;
  sessionId: string;
  capability: Capability;
  previousValue: CapabilityValue | null;
  capturedAt: number;
}

export interface CommandLog {
  id: string;
  rawText: string;
  /** Serialized Intent. */
  intentJson: string;
  confidence: number;
  source: 'ollama' | 'fallback';
  createdAt: number;
}

export interface ActionExecution {
  id: string;
  commandId: string;
  capability: Capability;
  status: ActionStatus;
  reason: string;
  beforeValue: CapabilityValue | null;
  afterValue: CapabilityValue | null;
}

export interface PermissionState {
  key: string;
  granted: boolean;
  checkedAt: number;
}

/** Convenience shape for the Memory screen. Not a table. */
export interface MemoryEntry {
  label: string;
  detail: string;
  persistence: Extract<Persistence, 'persistent' | 'temporary'>;
  sourceCommand: string | null;
  createdAt: number;
  expiresAt: number | null;
}
