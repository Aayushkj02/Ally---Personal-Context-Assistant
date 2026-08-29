/**
 * OWNER: SHARED — FROZEN after the Day 1 contract PR.
 *
 * CONTRACT BOUNDARY 3: the native surface (SRS §10).
 *
 * BOTH the real Kotlin-backed module AND MockDevice implement this identically.
 * That parity is what lets Shlok and Dhrey work without waiting on the native build.
 */

import type { Capability, CapabilityValue, PermissionRequirement } from './capability';
import type { ActionResult } from './policy';

export interface DeviceCapability {
  /** False when the OEM/API level does not support it. Must be honest — never optimistic. */
  isAvailable(): Promise<boolean>;
  requiredPermissions(): Promise<PermissionRequirement[]>;
  /** Read the current value so we can restore it later. Null when unreadable. */
  snapshot(): Promise<CapabilityValue | null>;
  /** Apply the value, then READ IT BACK. Only return `applied` if the read-back matches. */
  execute(value: CapabilityValue): Promise<ActionResult>;
  restore(previous: CapabilityValue): Promise<ActionResult>;
}

export interface DeviceRegistry {
  /** Which backend is live. Surfaced in the UI so we never mistake a mock for the real thing. */
  readonly backend: 'native' | 'mock';
  get(capability: Capability): DeviceCapability;
  openSettingsFor(permission: PermissionRequirement['key']): Promise<void>;
}
