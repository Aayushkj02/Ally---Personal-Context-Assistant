/**
 * OWNER: DHREY — task D3.3 (Undo / Reversal)
 *
 * The single entry point for "undo that": picks the context, reads its originals, and
 * hands the execution layer a plan in the frozen ActionPlan shape it already consumes.
 *
 *   memory/reversal   which context, and what were the originals   (I/O)
 *        ↓
 *   policy/planner    originals → ActionPlan                       (pure)
 *        ↓
 *   src/actions       applies it to the device                     (Aayush)
 *
 * D3.3 STOPS AT THE PLAN. Nothing here calls a native API; `src/actions/index.ts` is
 * still `export {}`, and executing the restore is Aayush's side of contract boundary 2.
 */

import { findRestorationTarget, getRestorationTarget, type RestorationTarget } from '../memory';
import { buildRestorePlan } from '../policy';
import type { ActionPlan } from '../types';

export interface Reversal {
  target: RestorationTarget;
  /**
   * The restore, in the existing ActionPlan contract. Contains one action per original
   * with a known value; capabilities whose original could not be read are absent here
   * and listed in `target.unavailable` instead.
   */
  plan: ActionPlan;
}

function toReversal(target: RestorationTarget): Reversal {
  return {
    target,
    plan: buildRestorePlan(target.session.id, target.restorable),
  };
}

/**
 * What "undo that" should do, or null when there is nothing to undo.
 *
 * Null is the honest answer for "no context has run", "the last context captured
 * nothing", and "the last context was already restored and its snapshots cleaned up".
 * A caller must not treat null as an empty plan and report success.
 */
export async function planReversal(
  profileId: string,
  now: number = Date.now(),
): Promise<Reversal | null> {
  const target = await findRestorationTarget(profileId, now);
  return target ? toReversal(target) : null;
}

/**
 * Same, for one named context — "restore what you changed during Study" rather than
 * "undo that". Returns null when the session id is unknown.
 */
export async function planReversalForSession(sessionId: string): Promise<Reversal | null> {
  const target = await getRestorationTarget(sessionId);
  return target ? toReversal(target) : null;
}
