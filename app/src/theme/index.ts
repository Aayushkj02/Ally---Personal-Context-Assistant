/**
 * OWNER: DHREY — task D4. FREEZE AT END OF PHASE 1.
 *
 * Design tokens: colour, spacing, radii, type scale. Highest-conflict file in the UI
 * tree, which is why it has exactly one owner and gets frozen once Phase 1 closes.
 *
 * Status-chip colours are a rubric item and must come from STATUS_PRESENTATION in
 * src/types/policy.ts — that is the single source of truth. Do not redefine them here:
 *   applied green · permission_needed amber · not_supported grey
 *   skipped grey · failed red · restored blue
 */
export { colors } from './colors';
export { spacing } from './spacing';
export { typography } from './typography';
export { radius } from './radius';
