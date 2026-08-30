import type { IntentParser, ParseContext } from './index';

import { EMPTY_INTENT, type Channel, type Intent, type ParseResult } from '../../types';

/** Written-out number words that appear in duration phrases. */
const WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  sixty: 60,
  ninety: 90,
};

function extractDurationMinutes(text: string): number | null {
  // Numeric hours
  const numericHoursMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);
  if (numericHoursMatch) {
    return Math.round(Number(numericHoursMatch[1]) * 60);
  }

  // Written-out hours: "two hours", "three hours"
  const wordHoursMatch = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty|ninety)\s+hours?\b/i,
  );
  if (wordHoursMatch) {
    const word = wordHoursMatch[1]?.toLowerCase() ?? '';
    const num = WORD_TO_NUMBER[word];
    if (num !== undefined) return num * 60;
  }

  // Numeric minutes
  const numericMinutesMatch = text.match(/(\d+)\s*(?:minutes?|mins?)/i);
  if (numericMinutesMatch) {
    return Number(numericMinutesMatch[1]);
  }

  // Written-out minutes: "twenty minutes"
  const wordMinutesMatch = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty|ninety)\s+minutes?\b/i,
  );
  if (wordMinutesMatch) {
    const word = wordMinutesMatch[1]?.toLowerCase() ?? '';
    const num = WORD_TO_NUMBER[word];
    if (num !== undefined) return num;
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

/**
 * Detects the communication channel from phrasing like "call", "SMS", "message",
 * "WhatsApp". Defaults to 'calls' when no channel word is present (backward-compatible
 * with existing golden commands that say "let parents through" without a channel noun).
 */
function detectChannel(text: string): Channel {
  if (text.includes('whatsapp')) {
    return 'whatsapp';
  }
  if (
    text.includes(' sms') ||
    text.includes('text') ||
    text.includes('message') ||
    text.includes('messages')
  ) {
    return 'sms';
  }
  return 'calls';
}

/**
 * @param rawText   Original user text (preserves capitalisation for contact names).
 * @param normalized  Lowercased version (used for keyword matching).
 */
function extractExceptions(rawText: string, normalized: string): Intent['exceptions'] {
  const exceptions: Intent['exceptions'] = [];

  const durationMinutes = extractDurationMinutes(normalized);
  const text = normalized; // keyword matching always on lowercase

  // ── Group exceptions ─────────────────────────────────────────────────────

  // Parents / family group
  if (
    text.includes('let my parents') ||
    text.includes('allow my parents') ||
    text.includes('parents can call') ||
    text.includes('allow calls from parents') ||
    text.includes('allow my parents')
  ) {
    exceptions.push({
      type: 'contactGroup',
      value: 'parents',
      channel: detectChannel(text),
      effect: 'allow',
      durationMinutes,
    });
  }

  // Project group (calls, SMS, or WhatsApp)
  if (
    text.includes('let my project group') ||
    text.includes('allow my project group') ||
    text.includes('project group can notify') ||
    text.includes('let project group') ||
    text.includes('allow project group') ||
    text.includes('let my project whatsapp group') ||
    text.includes('project whatsapp group')
  ) {
    const projectChannel = detectChannel(text);
    exceptions.push({
      type: 'contactGroup',
      value: 'project group',
      channel: projectChannel,
      effect: 'allow',
      durationMinutes,
    });
  }

  // ── Individual contact exceptions ────────────────────────────────────────
  // Run contact-name patterns against rawText to preserve capitalisation
  // ("Mom" not "mom"), but use normalised lowercase for keyword filtering.

  const contactPatterns = [
    /\blet\s+(\w+(?:'s)?)\s+(?:call|sms|text|message|whatsapp)/i,
    /\ballow\s+(\w+(?:'s)?)\s+(?:to\s+)?(?:call|sms|text|message)/i,
    /\b(\w+)\s+(?:can\s+)?(?:call|sms|text|message)\s+(?:me|through)/i,
  ];

  const groupKeywords = ['my', 'parents', 'family', 'project', 'group', 'whatsapp', 'the'];

  for (const pattern of contactPatterns) {
    // Match against rawText so the captured name keeps its original casing
    const match = rawText.match(pattern);
    if (match) {
      const raw = match[1] ?? '';
      // Strip possessive apostrophe-s ("Mom's" → "Mom")
      const name = raw.replace(/'s$/i, '').trim();
      const nameLower = name.toLowerCase();

      // Skip if the captured word is a group keyword or activity word
      if (groupKeywords.includes(nameLower) || nameLower === 'study' || nameLower === 'sleep') {
        continue;
      }

      // Avoid duplicating a group exception we already added
      const alreadyCaptured = exceptions.some((e) => e.value.toLowerCase() === nameLower);
      if (alreadyCaptured) continue;

      exceptions.push({
        type: 'contact',
        value: name, // capitalisation preserved from rawText
        channel: detectChannel(text), // detectChannel uses normalised
        effect: 'allow',
        durationMinutes,
      });
      break; // only capture the first individual contact per sentence
    }
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
      normalized.includes('whenever i') ||
      normalized.includes('remember this') ||
      normalized.includes('remember that') ||
      normalized.includes('remember for')
    ) {
      operation = 'teach';
    } else if (
      // NOTE: deactivate is checked BEFORE activate to prevent the substring
      // collision where 'deactivate' also matches 'activate' (bug: Case 23).
      normalized.includes('done') ||
      normalized.includes('stop') ||
      normalized.includes('deactivate') ||
      normalized.includes('finished') ||
      normalized.includes('undo') ||
      normalized.includes('end study') ||
      normalized.includes('end sleep')
    ) {
      operation = 'deactivate';
    } else if (
      normalized.includes('going to') ||
      normalized.includes('start') ||
      normalized.includes('activate')
    ) {
      operation = 'activate';
    } else if (
      normalized.includes('change') ||
      normalized.includes('modify') ||
      normalized.includes('set')
    ) {
      operation = 'modify';
    } else if (
      normalized.includes('let ') ||
      normalized.includes('allow ') ||
      normalized.includes('through')
    ) {
      // Exception / priority commands that don't match an explicit operation word
      // are best modelled as a teach (persistent preference) when no session is active,
      // or as a temporary override when a session is already active.
      operation = ctx?.activeActivity ? 'modify' : 'teach';
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
    const exceptions = extractExceptions(rawText, normalized);
    const confidence = calculateConfidence(activity, operation, normalized);

    // WhatsApp exceptions are preference-only; surface that with requiresConfirmation.
    const hasWhatsApp = exceptions.some((e) => e.channel === 'whatsapp');

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
      requiresConfirmation: hasWhatsApp || confidence < 0.7,
    };

    return {
      kind: 'intent',
      intent,
    };
  }
}
