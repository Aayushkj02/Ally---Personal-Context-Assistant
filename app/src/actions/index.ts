/**
 * OWNER: AAYUSH — tasks T6, T7, A-V1
 *
 * PUBLIC SURFACE of the action engine. CONSUMES ActionPlan (produced by Dhrey's
 * policy layer) and returns ActionResult[] — see docs/CONTRACTS.md §2.
 *
 * Executes ONLY what is in the plan. No inferred extras, no capability not in the
 * allow-list. This layer is the only thing in the app permitted to change the phone.
 */

export { executePlan, restoreSession, lifoOrder } from './executors';
export type { ActionPhase, ActionProgress, ExecutionDeps, RestoreDeps } from './executors';
export { checkPermissions, permissionNeededResult } from './PermissionGate';
export type { PermissionCheck } from './PermissionGate';
export {
  buildSnapshot,
  createInMemorySnapshotStore,
  snapshotId,
  type SnapshotStore,
} from './SnapshotStore';
export { createRepositorySnapshotStore } from './snapshotStoreAdapter';
export { startContext, endContext, restoreContext } from './ContextCoordinator';
export type {
  ContextState,
  LifecycleHooks,
  CoordinatorDeps,
  StartContextResult,
  EndContextResult,
  EndContextOptions,
} from './ContextCoordinator';
export { summarisePlan, summariseRestore } from './summaries';
export type { PlanSummary, RestoreSummary } from './summaries';
