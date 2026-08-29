/**
 * OWNER: AAYUSH — tasks T6, T7
 *
 * PUBLIC SURFACE of the action engine. CONSUMES ActionPlan (produced by Dhrey's
 * policy layer) and returns ActionResult[] — see docs/CONTRACTS.md §2.
 *
 * Executes ONLY what is in the plan. No inferred extras, no capability not in the
 * allow-list. This layer is the only thing in the app permitted to change the phone.
 */

export {};
