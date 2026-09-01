/**
 * OWNER: DHREY — task D-V1 (Phase 2 vertical slice)
 *
 * Implements the spine of FLOW.md §2, from validated Intent to ActionPlan:
 *
 *   text → IntentEngine → validated Intent → memory/profile → PolicyEngine → ActionPlan
 *
 * This file is the ONLY place those layers meet. It exists because each of them is
 * deliberately ignorant of the others: the AI never touches SQLite, and
 * PolicyEngine.resolve() is pure with zero I/O. Someone has to do the reads, and it
 * is this module — not the policy engine, which must stay unit-testable without a
 * device or a database.
 *
 * It does NOT execute anything. Producing the ActionPlan is where Dhrey's
 * responsibility ends and Aayush's action engine begins (FLOW.md §5, ADR-006
 * contract boundary 2).
 */

import { intentEngine, type IntentEngine } from '../ai';
import { IntentValidator } from '../ai/validators';
import { commandRepository, loadProfileContext, startSession } from '../memory';
import { profileRepository, priorityRepository } from '../memory/repositories';
import { getModeDefinition, type ModeDefinition } from '../modes';
import { buildActionPlan, resolve, resolvePriority } from '../policy';
import type { ResolvedPriority } from '../policy';
import { buildPriorityRequest, type PriorityRequest } from './priorityIntegration';
import { memoryQueryService, type MemoryQueryResult } from './memoryQueryService';
import type {
  ActionPlan,
  Capability,
  CapabilityValue,
  Clarification,
  ContextProfile,
  Intent,
  ResolvedPolicy,
} from '../types';

/**
 * The priority half of the slice, resolved but NOT applied.
 *
 * D-V6 stops at the native boundary: this records what the device WOULD be asked
 * for, so the plan can be inspected without touching the phone. Actually applying it
 * is applyPriorityForContext() in priorityIntegration.ts (D-V5).
 *
 * Both fields are the existing D-V2/D-V5 types — this is a carrier, not a new format.
 */
export interface SlicePriority {
  resolved: ResolvedPriority;
  /** What would be sent to Android. No whatsapp field; repeatCallers always true. */
  request: PriorityRequest;
}

/**
 * Outcome of one activation attempt.
 *
 * Reuses the frozen contracts verbatim — Clarification, Intent, ResolvedPolicy and
 * ActionPlan are the existing types. This union is a carrier, not a new format.
 */
export type ActivationOutcome =
  | { kind: 'clarification'; clarification: Clarification }
  | {
      kind: 'activated';
      intent: Intent;
      profile: ContextProfile;
      policy: ResolvedPolicy;
      plan: ActionPlan;
      /** Resolved from stored priority rows; not applied to the device (D-V6). */
      priority: SlicePriority;
    }
  | {
      kind: 'taught';
      intent: Intent;
      profile: ContextProfile;
    }
  | {
      kind: 'memory-query';
      intent: Intent;
      profile: ContextProfile;
      memory: MemoryQueryResult;
    };

export interface ActivationDeps {
  /** Defaults to the real engine. Injectable so tests need no network. */
  engine?: IntentEngine;
  /** Injectable clock, so tests are deterministic. */
  now?: number;
}

/** Collision-resistant enough for local rows; no dependency added for this. */
function newId(prefix: string, now: number): string {
  return `${prefix}_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Flatten a mode file's default actions into the shape resolve() expects.
 *
 * The cast is safe: resolve() guards every lookup with `capability in modeDefaults`,
 * so a mode that defines only some capabilities (study.json has no alarm) simply
 * yields no entry for the rest.
 */
function toModeDefaults(mode: ModeDefinition): Record<Capability, CapabilityValue> {
  const defaults: Partial<Record<Capability, CapabilityValue>> = {};
  for (const action of mode.defaults) {
    defaults[action.capability] = action.value;
  }
  return defaults as Record<Capability, CapabilityValue>;
}

function clarify(question: string, rawText: string): ActivationOutcome {
  return {
    kind: 'clarification',
    clarification: { kind: 'clarification', question, options: ['Study', 'Sleep'], rawText },
  };
}

/**
 * Turn a raw sentence into an ActionPlan.
 *
 * Anything the parser could not resolve confidently comes back as a Clarification and
 * NEVER reaches the policy engine (FLOW.md §9).
 */
export async function activateFromText(
  text: string,
  deps: ActivationDeps = {},
): Promise<ActivationOutcome> {
  const engine = deps.engine ?? intentEngine;
  const now = deps.now ?? Date.now();

  // 1. Natural language → Intent.
  const parsed = await engine.parse(text);

  // 2. Re-run the validator at the policy boundary. It is idempotent, and it is the
  //    security boundary (FLOW.md §3): not every producer of an Intent goes through
  //    the engine — FLOW.md §1 has deep links constructing one directly — so the
  //    guarantee belongs here, where policy is actually entered.
  const validated = IntentValidator.validate(parsed);
  if (validated.kind === 'clarification') {
    return { kind: 'clarification', clarification: validated };
  }

  const intent = validated.intent;

  // 3. Persist the command verbatim. This is the provenance the Memory screen reads
  //    back as "because you said '…'" — see FLOW.md §7.
  await commandRepository.createCommand({
    id: newId('cmd', now),
    rawText: intent.rawText,
    intentJson: JSON.stringify(intent),
    confidence: intent.confidence,
    source: intent.source,
    createdAt: now,
  });

  // 4. Resolve the profile this activity maps to and load everything policy needs, in
  //    one memory-layer call (D-V3). The orchestrator no longer knows which repositories
  //    are involved — that is the memory layer's business.
  const mode = getModeDefinition(intent.activity);
  if (!mode) {
    return clarify('Which context profile would you like to use?', intent.rawText);
  }

  const context = await loadProfileContext(intent.activity, { now });
  if (!context) {
    return clarify('Which context profile would you like to use?', intent.rawText);
  }

  const { profile } = context;

  // 4.5 Phase 4 Teaching Persistence Routing (D4.2 & D4.3)
  const isPersistentCorrection =
    intent.operation === 'teach' || intent.persistence === 'persistent';

  if (isPersistentCorrection) {
    // Persist Capability Preferences
    for (const change of intent.requestedChanges) {
      await profileRepository.createPreference({
        id: newId('pref', now),
        profileId: profile.id,
        capability: change.capability,
        value: change.value,
        source: 'user',
        sourceCommand: intent.rawText,
        createdAt: now,
      });
    }

    // Persist Priority Exceptions
    for (const exception of intent.exceptions) {
      if (exception.effect === 'allow') {
        await priorityRepository.addPreference({
          profileId: profile.id,
          channel: exception.channel ?? 'calls',
          subject: exception.value,
          subjectKind: exception.type,
          sourceCommand: intent.rawText,
          now,
        });
      } else if (exception.effect === 'block') {
        // D4.3: Deterministic removal by natural key
        const allPrefs = await priorityRepository.listForProfile(profile.id);
        const target = allPrefs.find(
          (p) =>
            p.channel === (exception.channel ?? 'calls') &&
            p.subject.toLowerCase() === exception.value.toLowerCase()
        );
        if (target) {
          await priorityRepository.removePreference(target.id);
        }
      }
    }

    return { kind: 'taught', intent, profile };
  }

  // 4.6 Phase 4 Memory Query Routing (D4.4)
  if (intent.operation === 'query') {
    const memory = await memoryQueryService.queryProfileMemory(profile.id);
    return { kind: 'memory-query', intent, profile, memory };
  }

  // 5. Pure resolution. Precedence stays exactly as D2 defined it — memory supplied the
  //    rows, policy decides which one wins.
  const policy = resolve(
    intent,
    profile,
    context.preferences,
    context.overrides,
    toModeDefaults(mode),
    now,
  );

  // 6. Resolve the stored priority list (D-V2's pure resolver, via D-V5's request
  //    builder). NOT applied here: D-V6 stops at the native boundary, so this records
  //    what the device would be asked for without touching it.
  const resolvedPriority = resolvePriority(profile.id, context.priorityPreferences);
  const priority: SlicePriority = {
    resolved: resolvedPriority,
    request: buildPriorityRequest(resolvedPriority),
  };

  // 7. A plan needs a session to belong to, and restoration later reads snapshots by
  //    session id (FLOW.md §6). READY, not ACTIVE — nothing has been applied yet.
  const session = await startSession({
    profileId: profile.id,
    now,
    durationMinutes: intent.durationMinutes,
  });

  // 8. Hand off across contract boundary 2.
  const plan = buildActionPlan(session.id, policy, intent.persistence);

  return { kind: 'activated', intent, profile, policy, plan, priority };
}
