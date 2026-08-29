/**
 * OWNER: AAYUSH — task T7
 *
 * executePlan(): walks an ActionPlan in order. Per action (FLOW.md §5):
 *
 *   permission? -> available? -> snapshot (if needsSnapshot) -> execute -> READ BACK
 *
 * THE READ-BACK IS NOT OPTIONAL. `applied` may only be returned for a write we
 * confirmed by reading the value again; everything else is failed /
 * permission_needed / not_supported. This is the "never fake success" rule
 * (PRD §20, NFR-03) — the single most load-bearing rule in the codebase.
 *
 * One action failing NEVER aborts the plan. Each row reports independently.
 * Restore runs in LIFO order, driven only by persisted snapshots.
 */

export {};
