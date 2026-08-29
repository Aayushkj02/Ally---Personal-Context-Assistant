/**
 * OWNER: DHREY — task D4. FREEZE AT END OF PHASE 1.
 *
 * Zustand app store: session state, parse state, last result, permission status.
 * Shape is frozen after Phase 1 for the same reason src/types/ is (ADR-006) — it is
 * imported by every screen, so churn here is a three-way conflict.
 *
 * SessionState values are FROZEN in src/types/policy.ts (PRD §15 lifecycle).
 */

export {};
