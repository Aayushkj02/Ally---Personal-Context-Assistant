/**
 * OWNER: SHARED — FROZEN after the Day 1 contract PR.
 *
 * CONTRACT BOUNDARY 1:  Shlok PRODUCES Intent  →  Dhrey CONSUMES Intent.
 * Neither side reads the other's implementation. Both sides code against this file.
 *
 * The AI's only job is to emit a valid Intent. It never touches an Android API.
 */

import type { Capability, CapabilityValue, Channel } from './capability';

export const ACTIVITIES = ['study', 'sleep', 'unknown'] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const OPERATIONS = ['activate', 'deactivate', 'teach', 'modify', 'query'] as const;
export type Operation = (typeof OPERATIONS)[number];

/**
 * session     — applies to this run only
 * temporary   — time-bounded exception, auto-expires (SRS FR-10)
 * persistent  — write it into the profile (requires explicit user intent, SRS FR-09)
 * unspecified — the parser could not tell; policy engine falls back to `session`
 */
export const PERSISTENCE = ['session', 'temporary', 'persistent', 'unspecified'] as const;
export type Persistence = (typeof PERSISTENCE)[number];

export interface IntentSchedule {
  kind: 'none' | 'once' | 'weekdays';
  /** "HH:MM" 24-hour, or null when kind === 'none'. */
  time: string | null;
}

export interface RequestedChange {
  capability: Capability;
  value: CapabilityValue;
}

export interface IntentException {
  type: 'contact' | 'contactGroup';
  /**
   * Which channel the exception applies to. Optional and backward compatible —
   * absent means "calls", which is what every existing golden command means.
   * Lets the parser distinguish "let Mom CALL me" from "let Mom MESSAGE me".
   */
  channel?: Channel;
  /** Raw subject as the user said it: "parents", "Mom", "project group". */
  value: string;
  effect: 'allow' | 'block';
  /** Minutes, when the user bounded it ("for 20 minutes"). null = unbounded. */
  durationMinutes: number | null;
}

export interface Intent {
  activity: Activity;
  operation: Operation;
  durationMinutes: number | null;
  schedule: IntentSchedule | null;
  persistence: Persistence;
  requestedChanges: RequestedChange[];
  exceptions: IntentException[];
  /** 0..1. Below CONFIDENCE_THRESHOLD we clarify instead of executing (SRS FR-21). */
  confidence: number;
  requiresConfirmation: boolean;
  /** Verbatim user text. Powers the Memory screen's "because you said …" provenance. */
  rawText: string;
  /** Which path produced this. Rendered as a small debug chip — proves the fallback is real. */
  source: 'ollama' | 'fallback';
}

export const CONFIDENCE_THRESHOLD = 0.7;

/** Returned instead of executing when the parser is unsure or the request is unmapped. */
export interface Clarification {
  kind: 'clarification';
  question: string;
  /** Suggested replies rendered as chips. Keep to 2–3. */
  options: string[];
  rawText: string;
}

export type ParseResult = { kind: 'intent'; intent: Intent } | Clarification;

/** An Intent with every field at its safe default. Parsers build up from this. */
export const EMPTY_INTENT: Omit<Intent, 'rawText' | 'source'> = {
  activity: 'unknown',
  operation: 'query',
  durationMinutes: null,
  schedule: null,
  persistence: 'unspecified',
  requestedChanges: [],
  exceptions: [],
  confidence: 0,
  requiresConfirmation: true,
};
