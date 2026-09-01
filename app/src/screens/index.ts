/**
 * OWNER: split per screen — create your own directory, never another's.
 *
 * Pre-declared here so two people never create the same path (Phase 2+ work):
 *
 *   Home/           AAYUSH   mic, transcript, result card          T10
 *   ActiveContext/  AAYUSH   countdown, applied changes, End/Undo  T10
 *   Permissions/    AAYUSH   capability status + settings links    T6
 *   Onboarding/     DHREY    explanation + permission grants       D5
 *   Profiles/       DHREY    Study / Sleep cards                   D5
 *   Memory/         DHREY    what Ally remembers, and WHY          D5
 *   History/        DHREY    command + action audit log            D5
 *
 * None of these are Phase 1 work.
 */

export { default as HomeScreen } from './Home';
export type { HomeScreenProps } from './Home';
export { default as ActiveContextScreen } from './ActiveContext';
export type { ActiveContextScreenProps } from './ActiveContext';
export { default as PriorityScreen } from './Priority';
export type { PriorityScreenProps } from './Priority';
