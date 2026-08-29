/**
 * OWNER: DHREY
 *
 * One repository per aggregate. Each returns the row types from src/types/models.ts;
 * nothing above this layer writes SQL.
 *
 *   priorityRepository   priority_preference  (implemented)
 *   profileRepository    context_profile + preference        (pending)
 *   sessionRepository    context_session                     (pending)
 *   overrideRepository   temporary_override                  (pending)
 *   snapshotRepository   device_snapshot  <- restoration source of truth (pending)
 */

export * as priorityRepository from './priorityRepository';
