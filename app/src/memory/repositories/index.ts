/**
 * OWNER: DHREY — task D1
 *
 * One repository per aggregate. Each returns the row types from src/types/models.ts;
 * nothing above this layer writes SQL.
 *
 *   profileRepository     context_profile + preference
 *   sessionRepository     context_session
 *   overrideRepository    temporary_override   (expiry filtered at read time)
 *   snapshotRepository    device_snapshot      ← restoration source of truth
 *   commandRepository     command_log + action_execution
 *
 * TWO COLUMNS CARRY PRODUCT WEIGHT — do not drop them as a write optimisation:
 *   preference.source_command   the verbatim sentence behind a remembered preference
 *   device_snapshot.previous_value   what restore reads; never recompute it
 */

export {};
