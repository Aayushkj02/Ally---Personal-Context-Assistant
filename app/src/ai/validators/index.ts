/**
 * OWNER: SHLOK — task S4
 *
 * THE SECURITY BOUNDARY. Model output is data, never instruction (SRS FR-05, FR-27).
 *
 * Must enforce, before anything reaches the policy engine:
 *   - every capability is in CAPABILITIES (allow-list)
 *   - every value sits inside CAPABILITY_DOMAIN
 *   - unknown capabilities are REJECTED, never coerced or guessed
 *   - confidence < CONFIDENCE_THRESHOLD returns a Clarification, not an Intent
 */

export {};
