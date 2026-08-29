import type { IntentParser, ParseContext } from './index';

import { EMPTY_INTENT, type Intent, type ParseResult } from '../../types';

function extractDurationMinutes(text: string): number | null {
  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);

  if (hoursMatch) {
    return Math.round(Number(hoursMatch[1]) * 60);
  }

  const minutesMatch = text.match(/(\d+)\s*(?:minutes?|mins?)/i);

  if (minutesMatch) {
    return Number(minutesMatch[1]);
  }

  return null;
}

function extractSchedule(text: string): Intent['schedule'] {
  const timeMatch = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  if (!timeMatch) {
    return null;
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? '00');
  const period = timeMatch[3]?.toLowerCase();

  if (period === 'pm' && hour !== 12) {
    hour += 12;
  }

  if (period === 'am' && hour === 12) {
    hour = 0;
  }

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const kind = text.includes('weekday') ? 'weekdays' : 'once';

  return {
    kind,
    time,
  };
}

function extractRequestedChanges(text: string): Intent['requestedChanges'] {
  const changes: Intent['requestedChanges'] = [];

  // Ringer
  if (
    text.includes('keep silent') ||
    text.includes('keep the phone silent') ||
    text.includes('ringer silent') ||
    text.includes('silent mode')
  ) {
    changes.push({
      capability: 'ringer',
      value: 'silent',
    });
  } else if (
    text.includes('keep vibrate') ||
    text.includes('ringer vibrate') ||
    text.includes('vibrate mode')
  ) {
    changes.push({
      capability: 'ringer',
      value: 'vibrate',
    });
  } else if (text.includes('ringer normal') || text.includes('normal ringer')) {
    changes.push({
      capability: 'ringer',
      value: 'normal',
    });
  }

  // DND
  if (
    text.includes('priority mode') ||
    text.includes('dnd priority') ||
    text.includes('priority only') ||
    text.includes('block notifications') ||
    text.includes('turn on dnd') ||
    text.includes('dnd on')
  ) {
    changes.push({
      capability: 'dnd',
      value: 'priority',
    });
  } else if (text.includes('alarms only') || text.includes('alarm only')) {
    changes.push({
      capability: 'dnd',
      value: 'alarms_only',
    });
  } else if (text.includes('total silence') || text.includes('total silence mode')) {
    changes.push({
      capability: 'dnd',
      value: 'total_silence',
    });
  } else if (
    text.includes('dnd off') ||
    text.includes('turn off dnd') ||
    text.includes('disable dnd')
  ) {
    changes.push({
      capability: 'dnd',
      value: 'off',
    });
  }

  // Brightness
  const brightnessMatch = text.match(/brightness(?:\s+to|\s+at|\s+of)?\s*(\d{1,3})\s*%?/i);

  if (brightnessMatch) {
    const brightness = Number(brightnessMatch[1]);

    if (brightness >= 0 && brightness <= 100) {
      changes.push({
        capability: 'brightness',
        value: brightness,
      });
    }
  }

  // Alarm
  const alarmMatch = text.match(
    /\b(?:wake me|alarm|wake up)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );

  if (alarmMatch) {
    let hour = Number(alarmMatch[1]);
    const minute = Number(alarmMatch[2] ?? '00');
    const period = alarmMatch[3]?.toLowerCase();

    if (period === 'pm' && hour !== 12) {
      hour += 12;
    }

    if (period === 'am' && hour === 12) {
      hour = 0;
    }

    const alarmTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    changes.push({
      capability: 'alarm',
      value: alarmTime,
    });
  }

  return changes;
}

function extractExceptions(text: string): Intent['exceptions'] {
  const exceptions: Intent['exceptions'] = [];

  const durationMinutes = extractDurationMinutes(text);

  // Parents / family
  if (
    text.includes('let my parents') ||
    text.includes('allow my parents') ||
    text.includes('parents can call')
  ) {
    exceptions.push({
      type: 'contactGroup',
      value: 'parents',
      effect: 'allow',
      durationMinutes,
    });
  }

  // Project group
  if (
    text.includes('let my project group') ||
    text.includes('allow my project group') ||
    text.includes('project group can notify')
  ) {
    exceptions.push({
      type: 'contactGroup',
      value: 'project group',
      effect: 'allow',
      durationMinutes,
    });
  }

  return exceptions;
}

function calculateConfidence(
  activity: Intent['activity'],
  operation: Intent['operation'],
  text: string,
): number {
  if (activity === 'unknown') {
    return 0;
  }

  let confidence = 0.6;

  if (operation !== 'query') {
    confidence += 0.2;
  }

  if (text.length > 0) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1);
}

export class FallbackParser implements IntentParser {
  readonly name = 'fallback' as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async parse(text: string, ctx?: ParseContext): Promise<ParseResult> {
    const rawText = text;
    const normalized = text.trim().toLowerCase();

    if (!normalized) {
      return {
        kind: 'clarification',
        question: 'What would you like Ally to do?',
        options: ['Study', 'Sleep'],
        rawText,
      };
    }

    let activity: Intent['activity'] = 'unknown';

    if (normalized.includes('study') || normalized.includes('studying')) {
      activity = 'study';
    } else if (
      normalized.includes('sleep') ||
      normalized.includes('sleeping') ||
      normalized.includes('bed')
    ) {
      activity = 'sleep';
    } else if (ctx?.activeActivity) {
      activity = ctx.activeActivity;
    }

    let operation: Intent['operation'] = 'query';

    if (
      normalized.includes('when i study') ||
      normalized.includes('when i sleep') ||
      normalized.includes('remember this') ||
      normalized.includes('remember that')
    ) {
      operation = 'teach';
    } else if (
      normalized.includes('going to') ||
      normalized.includes('start') ||
      normalized.includes('activate')
    ) {
      operation = 'activate';
    } else if (
      normalized.includes('done') ||
      normalized.includes('stop') ||
      normalized.includes('deactivate') ||
      normalized.includes('finished') ||
      normalized.includes('undo')
    ) {
      operation = 'deactivate';
    } else if (
      normalized.includes('change') ||
      normalized.includes('modify') ||
      normalized.includes('set')
    ) {
      operation = 'modify';
    }

    if (activity === 'unknown') {
      return {
        kind: 'clarification',
        question: 'What would you like Ally to do?',
        options: ['Study', 'Sleep'],
        rawText,
      };
    }

    const durationMinutes = extractDurationMinutes(normalized);
    const schedule = extractSchedule(normalized);
    const requestedChanges = extractRequestedChanges(normalized);
    const exceptions = extractExceptions(normalized);
    const confidence = calculateConfidence(activity, operation, normalized);

    const intent: Intent = {
      ...EMPTY_INTENT,
      activity,
      operation,
      durationMinutes,
      schedule,
      requestedChanges,
      exceptions,
      rawText,
      source: 'fallback',
      confidence,
      requiresConfirmation: confidence < 0.7,
    };

    return {
      kind: 'intent',
      intent,
    };
  }
}
