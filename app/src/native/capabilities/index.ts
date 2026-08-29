/**
 * OWNER: AAYUSH — tasks T3 (DND), T4 (brightness), T5 (alarm)
 *
 * Real, Kotlin-backed implementations of DeviceCapability — one file per capability:
 *   DndCapability.ts, BrightnessCapability.ts, AlarmCapability.ts, RingerCapability.ts
 *
 * PARITY OBLIGATION (ADR-007): whatever changes here changes in ../MockDevice.ts in
 * the SAME commit. A drifted mock is worse than no mock.
 *
 * isAvailable() must be HONEST, not optimistic. A truthful `not_supported` scores
 * better than a fake success — see the DND ladder in ADR-102 and docs/DEVICE_NOTES.md.
 */

export {};
