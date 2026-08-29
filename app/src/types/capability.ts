/**
 * OWNER: SHARED — FROZEN after the Day 1 contract PR.
 * Changing anything in src/types/ requires all three of us to agree in person,
 * and ONE person makes the edit. This is the #1 merge-conflict source in the repo.
 *
 * The capability allow-list. If it is not in CAPABILITIES, it cannot execute.
 * This enforces SRS FR-13 (allow-listed actions) and FR-27 (no raw AI commands).
 */

export const CAPABILITIES = ['dnd', 'brightness', 'alarm', 'ringer'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

/** Android Zen / interruption filter levels we support. */
export const DND_MODES = ['off', 'priority', 'alarms_only', 'total_silence'] as const;
export type DndMode = (typeof DND_MODES)[number];

export const RINGER_MODES = ['normal', 'vibrate', 'silent'] as const;
export type RingerMode = (typeof RINGER_MODES)[number];

/**
 * The wire value for a capability. Deliberately narrow — the validator
 * (src/ai/IntentValidator.ts) rejects anything outside these domains.
 *
 *   dnd        → DndMode
 *   brightness → integer 0..100 (percent)
 *   alarm      → "HH:MM" 24-hour
 *   ringer     → RingerMode
 */
export type CapabilityValue = string | number;

export const CAPABILITY_DOMAIN: Record<
  Capability,
  { kind: 'enum' | 'percent' | 'time'; values?: readonly string[] }
> = {
  dnd: { kind: 'enum', values: DND_MODES },
  brightness: { kind: 'percent' },
  alarm: { kind: 'time' },
  ringer: { kind: 'enum', values: RINGER_MODES },
};

/**
 * Communication channels a priority preference can apply to.
 *
 * ENFORCEMENT DIFFERS BY CHANNEL and the UI must say so (ADR-111):
 *   calls    Android enforces, via NotificationManager.Policy PRIORITY_CATEGORY_CALLS
 *   sms      Android enforces, via PRIORITY_CATEGORY_MESSAGES
 *   whatsapp Ally REMEMBERS ONLY. No public API lets one app grant another app's
 *            notifications a DND bypass. Android 16 has per-app bypass internally
 *            (`mAppBypassDndList`) but it is not in the public SDK.
 *
 * Calls and SMS are further limited to Android's sender SCOPES — starred contacts,
 * all contacts, or anyone. There is no per-individual-contact DND exception for apps.
 */
export const CHANNELS = ['calls', 'sms', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

/** The granularity Android actually offers. Not per-contact. */
export const SENDER_SCOPES = ['starred', 'contacts', 'anyone'] as const;
export type SenderScope = (typeof SENDER_SCOPES)[number];

/** Which channels the device can actually enforce, as opposed to merely remember. */
export const CHANNEL_ENFORCEABLE: Record<Channel, boolean> = {
  calls: true,
  sms: true,
  whatsapp: false,
};

/**
 * What actually happened to a channel's priority preference (ADR-113).
 *
 * The four states exist because "we saved your setting" and "your phone will behave
 * differently" are genuinely different promises, and collapsing them is how a product
 * ends up lying to its user:
 *
 *   enforced        Applied to Android AND confirmed by reading the policy back.
 *   preference_only Ally remembers it; Android exposes no way to act on it. WhatsApp.
 *   unsupported     The device or API level cannot do this at all.
 *   failed          We attempted it and Android did not hold the change.
 */
export const ENFORCEMENT_STATUSES = [
  'enforced',
  'preference_only',
  'unsupported',
  'failed',
] as const;
export type EnforcementStatus = (typeof ENFORCEMENT_STATUSES)[number];

export interface ChannelEnforcement {
  channel: Channel;
  status: EnforcementStatus;
  /** Plain language for the user. Never API jargon. */
  message: string;
}

/** UI copy per status, so screens cannot invent their own wording. */
export const ENFORCEMENT_PRESENTATION: Record<EnforcementStatus, { label: string; tone: string }> =
  {
    enforced: { label: 'Active on your phone', tone: 'success' },
    preference_only: { label: 'Remembered, not enforced', tone: 'warning' },
    unsupported: { label: 'Not supported on this device', tone: 'neutral' },
    failed: { label: 'Failed', tone: 'danger' },
  };

/** Android permission a capability needs before it may execute (SRS FR-12). */
export interface PermissionRequirement {
  /** Stable key used by the Permissions screen and PermissionState rows. */
  key: 'notification_policy' | 'write_settings' | 'microphone' | 'exact_alarm';
  /** Plain-language label shown to the user. Never API jargon. */
  label: string;
  /** Why we need it, in one sentence, in the user's words. */
  rationale: string;
  granted: boolean;
}
