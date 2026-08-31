/**
 * OWNER: DHREY — task D1
 *
 * PUBLIC SURFACE of the data layer. Screens and use cases import ONLY this file.
 * Seeds Study and Sleep on first run from src/modes/*.json (ADR-004).
 */

export { getDatabase } from './database';
export * from './repositories';
export { ensureSeeded } from './seed';
export {
  startSession,
  startSessionForProfile,
  markSessionActive,
  endSession,
  getActiveContext,
  getActiveSessionForProfile,
  listSessionHistory,
  getSessionSnapshots,
} from './session';
export type { ActiveContext, StartSessionInput, EndSessionOptions } from './session';
export {
  resolveProfileForActivity,
  loadProfileContext,
  loadContextForProfile,
  knownActivities,
} from './profileContext';
export type { ProfileContext, LookupOptions } from './profileContext';
export {
  getRestoreHistory,
  listRestoreHistory,
  listCompletedContexts,
  listRestorableContexts,
  getOriginalValue,
} from './restoreHistory';
export type { RestoreHistoryEntry } from './restoreHistory';
