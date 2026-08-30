/**
 * OWNER: SHARED — FROZEN after the Day 1 contract PR.
 * Row shapes for the SQLite tables in docs/CONTRACTS.md §5.
 * Dhrey's repositories return these; everyone else consumes them read-only.
 */

import type { Capability, CapabilityValue, Channel } from './capability';
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

/**
 * A durable, mode-scoped decision about who may reach the user on a given channel.
 *
 * Distinct from TemporaryOverride, which is time-bounded and expires. This is the
 * standing priority list: "during Sleep, Mom can call me."
 *
 * `enforceable` is not decoration. WhatsApp preferences are remembered but Android
 * provides no way to act on them, and the UI must show that difference rather than
 * implying the phone is doing something it is not (ADR-111).
 */
export interface PriorityPreference {
  id: string;
  /** Mode-scoped: Study, Sleep and Focus each keep their own list. */
  profileId: string;
  channel: Channel;
  /** The person or group as the user named them: "Mom", "Family Group". */
  subject: string;
  subjectKind: 'contact' | 'contactGroup';
  enabled: boolean;
  /** False for whatsapp. Drives the honest "remembered, not enforced" UI state. */
  enforceable: boolean;
  /** Verbatim command that created this, for the Memory screen's provenance. */
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
