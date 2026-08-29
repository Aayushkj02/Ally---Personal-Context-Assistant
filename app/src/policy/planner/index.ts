/**
 * OWNER: DHREY — task D3 (Phase 2; scaffolded now to fix the ownership boundary)
 *
 * ActionPlanner: ResolvedPolicy -> ActionPlan.
 *
 * WHY THIS LIVES UNDER policy/ AND NOT actions/:
 * docs/CONTRACTS.md §2 states ActionPlan is PRODUCED by Dhrey and CONSUMED by Aayush.
 * Placing the planner in src/actions/ (Aayush's tree) would put two owners in one
 * directory and blur the frozen contract boundary. The planner is the last step of
 * the policy layer; src/actions/ is execution only.
 *
 * The planner marks `needsSnapshot` and `requiredPermission`. It NEVER calls native code.
 */

export {};
