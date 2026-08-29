/**
 * OWNER: SHARED — FROZEN after the Day 1 contract PR.
 *
 * CONTRACT BOUNDARY 2:  Dhrey PRODUCES ActionPlan  →  Aayush CONSUMES ActionPlan.
 * Dhrey's policy engine never calls native code. Aayush's action engine never reads the DB.
 */

import type { Capability, CapabilityValue, PermissionRequirement } from './capability';

/** Where a resolved value came from. Drives the "reason" shown in the UI. */
export const PREFERENCE_SOURCES = ['command', 'override', 'profile', 'default'] as const;
export type PreferenceSource = (typeof PREFERENCE_SOURCES)[number];

/**
 * Output of PolicyEngine.resolve().
 * Precedence (SRS FR-11):  command  >  override  >  profile  >  default
 */
export interface ResolvedPolicy {
  activity: string;
  profileId: string;
  durationMinutes: number | null;
  entries: ResolvedEntry[];
  /** Exceptions that survived resolution, with their expiry already computed. */
  exceptions: ResolvedException[];
}

export interface ResolvedEntry {
  capability: Capability;
  value: CapabilityValue;
  source: PreferenceSource;
  /** Human sentence for the UI: "from your Study profile". */
  reason: string;
}

export interface ResolvedException {
  subject: string;
  effect: 'allow' | 'block';
  /** Epoch ms. null = persistent (part of the profile). */
  expiresAt: number | null;
  source: PreferenceSource;
}

// ---------------------------------------------------------------------------
// ActionPlan — the handoff to the action engine
// ---------------------------------------------------------------------------

export interface PlannedAction {
  capability: Capability;
  value: CapabilityValue;
  /** True when we must read-and-store the current value before mutating it. */
  needsSnapshot: boolean;
  requiredPermission: PermissionRequirement['key'] | null;
  /** Rendered verbatim under the action row in the result card. */
  reason: string;
}

export interface ActionPlan {
  sessionId: string;
  actions: PlannedAction[];
  /** False for one-shot actions like scheduling an alarm. */
  restoreOnEnd: boolean;
}

// ---------------------------------------------------------------------------
// ActionResult — truthful status. This vocabulary is a rubric item.
// NEVER report `applied` without a read-back verification (PRD §20 Reliability).
// ---------------------------------------------------------------------------

export const ACTION_STATUSES = [
  'applied',
  'permission_needed',
  'not_supported',
  'skipped',
  'failed',
  'restored',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface ActionResult {
  capability: Capability;
  status: ActionStatus;
  beforeValue: CapabilityValue | null;
  afterValue: CapabilityValue | null;
  /** Plain language for the user. "Android needs permission to change this." Not API jargon. */
  message: string;
}

/** UI copy + colour per status. Single source of truth for the StatusChip component. */
export const STATUS_PRESENTATION: Record<ActionStatus, { label: string; tone: string }> = {
  applied: { label: 'Applied', tone: 'success' },
  permission_needed: { label: 'Permission needed', tone: 'warning' },
  not_supported: { label: 'Not supported on this device', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  restored: { label: 'Restored', tone: 'info' },
};

// ---------------------------------------------------------------------------
// Context lifecycle (PRD §15)
// ---------------------------------------------------------------------------

export const SESSION_STATES = [
  'IDLE',
  'PARSING',
  'NEED_CONFIRMATION',
  'READY',
  'SNAPSHOTTING',
  'APPLYING',
  'ACTIVE',
  'OVERRIDING',
  'RESTORING',
  'PARTIAL',
  'ERROR',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];
