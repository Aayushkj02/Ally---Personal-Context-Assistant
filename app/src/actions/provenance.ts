/**
 * OWNER: AAYUSH — Phase 4 (A4.2)
 *
 * Keeps "why is my phone like this" attached to "what happened to my phone".
 *
 * Dhrey's resolver already decides where each value came from and writes a sentence for it —
 * `ResolvedEntry.source` is one of command / override / profile / default, and `entry.reason`
 * is the plain-language version. `buildActionPlan()` copies that sentence onto every
 * `PlannedAction`. Then it stopped: `ActionResult` has no field for it, so the moment the
 * executor turned a planned action into an outcome, the provenance was gone and the screen could
 * only ever say what changed, never why.
 *
 * That is the one thing Ally is supposed to be able to answer. A phone that dims is a setting; a
 * phone that dims AND can tell you it did so because you taught it to is the product.
 *
 * NOTHING IS INVENTED OR STORED HERE. `reason` is copied verbatim from the plan — this module
 * composes no sentences of its own, adds no field to the frozen `ActionResult`, and persists
 * nothing. It is a pairing, derived on demand from two things the caller already has, and it
 * relies on exactly one guarantee the executor already makes and documents: one ActionResult per
 * PlannedAction, in the same order.
 */

import type { ActionPlan, ActionResult } from '../types';

export interface ExplainedResult {
  result: ActionResult;
  /**
   * Verbatim `PlannedAction.reason` — "from your active profile", "from a temporary override".
   * Null when this row has no planned action behind it, which is the honest answer rather than
   * a guessed one: a restore is driven by snapshots, not by a plan, and a policy row recovered
   * without a snapshot (ADR-125) was never planned at all.
   */
  reason: string | null;
}

/**
 * Pairs each outcome with the reason its action carried.
 *
 * Positional, because that is the contract `executePlan()` guarantees and states: "the returned
 * array is exactly one ActionResult per PlannedAction, in the same order". Matching on
 * `capability` instead would look safer and be worse — a plan may legitimately contain two
 * actions for the same capability, and the first match would then be attributed to both.
 *
 * Extra results are tolerated with a null reason rather than dropped. `restoreSession()` can
 * append a row for the borrowed notification policy that no plan produced, and losing a row here
 * would mean the screen showed fewer things than actually happened.
 */
export function explainResults(plan: ActionPlan, results: ActionResult[]): ExplainedResult[] {
  return results.map((result, i) => ({
    result,
    reason: plan.actions[i]?.reason ?? null,
  }));
}

/** Just the reasons, positionally — for callers that already render `ActionResult[]` directly. */
export function reasonsFor(plan: ActionPlan, results: ActionResult[]): (string | null)[] {
  return explainResults(plan, results).map((e) => e.reason);
}
