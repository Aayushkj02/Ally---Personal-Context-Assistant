import {
  ACTIVITIES,
  CAPABILITY_DOMAIN,
  CHANNELS,
  CONFIDENCE_THRESHOLD,
  EMPTY_INTENT,
  isCapability,
  OPERATIONS,
  PERSISTENCE,
  type Capability,
  type CapabilityValue,
  type Clarification,
  type Intent,
  type IntentException,
  type IntentSchedule,
  type ParseResult,
  type RequestedChange,
} from '../../types';

export class IntentValidator {
  /**
   * Validates a ParseResult or raw intent.
   * Security boundary: enforces allow-listed capabilities, domain constraints,
   * confidence thresholds, and enum safety.
   */
  static validate(result: ParseResult): ParseResult {
    if (result.kind === 'clarification') {
      return result;
    }

    const intent = result.intent;

    // Check confidence threshold (SRS FR-21, FR-05)
    if (typeof intent.confidence !== 'number' || intent.confidence < CONFIDENCE_THRESHOLD) {
      return {
        kind: 'clarification',
        question: 'Could you clarify what you would like Ally to do?',
        options: ['Study', 'Sleep'],
        rawText: intent.rawText ?? '',
      };
    }

    // Check activity
    if (
      !intent.activity ||
      !ACTIVITIES.includes(intent.activity) ||
      intent.activity === 'unknown'
    ) {
      return {
        kind: 'clarification',
        question: 'Which context profile would you like to use?',
        options: ['Study', 'Sleep'],
        rawText: intent.rawText ?? '',
      };
    }

    // Check operation
    if (!intent.operation || !OPERATIONS.includes(intent.operation)) {
      return {
        kind: 'clarification',
        question: 'What action would you like to take?',
        options: ['Activate', 'Deactivate'],
        rawText: intent.rawText ?? '',
      };
    }

    // Check persistence
    const persistence = PERSISTENCE.includes(intent.persistence)
      ? intent.persistence
      : 'unspecified';

    // Validate requested changes (allow-listed capabilities and domain validation)
    const validatedChanges: RequestedChange[] = [];
    if (Array.isArray(intent.requestedChanges)) {
      for (const change of intent.requestedChanges) {
        if (!change || !isCapability(change.capability)) {
          // Reject unknown capability - return clarification (SRS FR-28)
          return {
            kind: 'clarification',
            question: `Ally cannot manage '${String((change as unknown as Record<string, unknown>)?.capability ?? 'unknown')}'. Did you mean ringer, brightness, DND, or alarm?`,
            options: ['Study', 'Sleep'],
            rawText: intent.rawText ?? '',
          };
        }

        if (!IntentValidator.isValidCapabilityValue(change.capability, change.value)) {
          return {
            kind: 'clarification',
            question: `Invalid setting value for '${change.capability}'. Please specify a valid value.`,
            options: ['Study', 'Sleep'],
            rawText: intent.rawText ?? '',
          };
        }

        validatedChanges.push({
          capability: change.capability,
          value: change.value,
        });
      }
    }

    // Validate exceptions
    const validatedExceptions: IntentException[] = [];
    if (Array.isArray(intent.exceptions)) {
      for (const exc of intent.exceptions) {
        if (
          exc &&
          (exc.type === 'contact' || exc.type === 'contactGroup') &&
          typeof exc.value === 'string' &&
          exc.value.trim().length > 0 &&
          (exc.effect === 'allow' || exc.effect === 'block')
        ) {
          const validatedExc: IntentException = {
            type: exc.type,
            value: exc.value.trim(),
            effect: exc.effect,
            durationMinutes:
              typeof exc.durationMinutes === 'number' && exc.durationMinutes > 0
                ? exc.durationMinutes
                : null,
          };
          // Preserve channel if it's a known value; drop silently if unrecognised
          if (exc.channel !== undefined && (CHANNELS as readonly string[]).includes(exc.channel)) {
            validatedExc.channel = exc.channel;
          }
          validatedExceptions.push(validatedExc);
        }
      }
    }

    // Validate schedule
    let validatedSchedule: IntentSchedule | null = null;
    if (intent.schedule) {
      if (intent.schedule.kind === 'none') {
        validatedSchedule = { kind: 'none', time: null };
      } else if (intent.schedule.kind === 'once' || intent.schedule.kind === 'weekdays') {
        if (
          typeof intent.schedule.time === 'string' &&
          IntentValidator.isValidTime(intent.schedule.time)
        ) {
          validatedSchedule = {
            kind: intent.schedule.kind,
            time: intent.schedule.time,
          };
        } else {
          return {
            kind: 'clarification',
            question: 'What time would you like to set for the alarm or schedule?',
            options: ['7:00 AM', '8:00 AM'],
            rawText: intent.rawText ?? '',
          };
        }
      }
    }

    // Return sanitized & validated intent
    const validatedIntent: Intent = {
      ...intent,
      activity: intent.activity,
      operation: intent.operation,
      durationMinutes:
        typeof intent.durationMinutes === 'number' && intent.durationMinutes > 0
          ? intent.durationMinutes
          : null,
      schedule: validatedSchedule,
      persistence,
      requestedChanges: validatedChanges,
      exceptions: validatedExceptions,
      confidence: intent.confidence,
      requiresConfirmation: intent.requiresConfirmation ?? intent.confidence < 0.7,
      rawText: intent.rawText ?? '',
      source: intent.source === 'ollama' ? 'ollama' : 'fallback',
    };

    return {
      kind: 'intent',
      intent: validatedIntent,
    };
  }

  static isValidCapabilityValue(capability: Capability, value: CapabilityValue): boolean {
    const domain = CAPABILITY_DOMAIN[capability];
    if (!domain) return false;

    if (domain.kind === 'enum') {
      return typeof value === 'string' && domain.values?.includes(value as never) === true;
    }

    if (domain.kind === 'percent') {
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
    }

    if (domain.kind === 'time') {
      return typeof value === 'string' && IntentValidator.isValidTime(value);
    }

    return false;
  }

  static isValidTime(timeStr: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr);
  }
}
