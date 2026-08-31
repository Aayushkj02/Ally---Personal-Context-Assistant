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

/**
 * Detects persistence semantics from the user's phrasing.
 *
 * persistent  — "always", "every time", "whenever I", "remember that", "learn that", "remember this preference"
 * temporary   — "while I study/sleep", "during this session", "for now", "this time"
 * unspecified — parser could not tell; policy engine falls back to `session`
 *
 * We deliberately do NOT invent a value — unspecified is a valid answer.
 */
function detectPersistence(text: string): Intent['persistence'] {
  if (
    text.includes('while i study') ||
    text.includes('while i sleep') ||
    text.includes('while studying') ||
    text.includes('while sleeping') ||
    text.includes('during this session') ||
    text.includes('during this study') ||
    text.includes('during this sleep') ||
    text.includes('for now') ||
    text.includes('just this time') ||
    text.includes('this time only')
  ) {
    return 'temporary';
  }

  if (
    text.includes('always') ||
    text.includes('every time') ||
    text.includes('whenever i') ||
    text.includes('remember that') ||
    text.includes('remember this preference') ||
    text.includes('learn that') ||
    text.includes('learn this')
  ) {
    return 'persistent';
  }

  return 'unspecified';
}

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

  // Brightness (supports "brightness to 50%", "40% brightness", "prefer 40% brightness")
  const brightnessMatch =
    text.match(/brightness(?:\s+to|\s+at|\s+of)?\s*(\d{1,3})\s*%?/i) ||
    text.match(/(\d{1,3})\s*%\s*brightness/i);

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
 * "WhatsApp", "reach". Defaults to 'calls' when no channel word is present (backward-compatible
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

  // Determine effect: 'block' for negation/removal commands, 'allow' otherwise
  const isBlock =
    text.includes("don't let") ||
    text.includes('dont let') ||
    text.includes('do not let') ||
    text.includes('block ') ||
    text.includes('remove ') ||
    text.includes('stop letting') ||
    text.includes('disallow') ||
    text.includes('never let') ||
    text.includes('forget ');

  const defaultEffect: 'allow' | 'block' = isBlock ? 'block' : 'allow';

  // ── Group exceptions ─────────────────────────────────────────────────────

  // Parents / family group
  if (
    text.includes('let my parents') ||
    text.includes('allow my parents') ||
    text.includes('parents can call') ||
    text.includes('allow calls from parents') ||
    text.includes('allow my parents') ||
    text.includes("don't let my parents") ||
    text.includes('dont let my parents') ||
    text.includes('remove parents')
  ) {
    exceptions.push({
      type: 'contactGroup',
      value: 'parents',
      channel: detectChannel(text),
      effect: defaultEffect,
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
    text.includes('project whatsapp group') ||
    text.includes('project group reach me') ||
    text.includes('project group message me') ||
    text.includes("don't let my project group") ||
    text.includes('dont let my project group') ||
    text.includes('do not let my project group') ||
    text.includes('remove my project group') ||
    text.includes('remove project group')
  ) {
    const projectChannel = detectChannel(text);
    exceptions.push({
      type: 'contactGroup',
      value: 'project group',
      channel: projectChannel,
      effect: defaultEffect,
      durationMinutes,
    });
  }

  // ── Individual contact exceptions ────────────────────────────────────────
  // Run contact-name patterns against rawText to preserve capitalisation
  // ("Mom" not "mom"), but use normalised lowercase for keyword filtering.

  const contactPatterns = [
    /\blet\s+(\w+(?:'s)?)\s+(?:call|sms|text|message|whatsapp|reach)/i,
    /\ballow\s+(\w+(?:'s)?)\s+(?:to\s+)?(?:call|sms|text|message|reach)/i,
    /\b(?:don't let|dont let|do not let|block|remove|stop letting|disallow|never let)\s+(\w+(?:'s)?)\s+(?:from|to|call|sms|text|message|whatsapp|reach)?/i,
    /\bremember\s+that\s+(\w+(?:'s)?)\s+can\s+(?:call|sms|text|message|whatsapp|reach)/i,
    /\bwhy\s+do\s+you\s+let\s+(\w+(?:'s)?)\s+(?:call|sms|text|message|whatsapp|reach)/i,
    /\b(\w+)\s+(?:can\s+)?(?:call|sms|text|message)\s+(?:me|through)/i,
  ];

  const groupKeywords = [
    'my',
    'parents',
    'family',
    'project',
    'group',
    'whatsapp',
    'the',
    'that',
    'from',
    'this',
  ];

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
        effect: defaultEffect,
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

  let confidence = 0.7;

  if (operation === 'query') {
    confidence = 0.85;
  } else {
    confidence += 0.1;
  }

  if (text.length > 0) {
    confidence += 0.05;
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

    // 1. Check queries first if phrasing clearly starts with question/memory query terms
    if (
      normalized.includes('what do you remember') ||
      normalized.includes('why do you') ||
      normalized.includes('when did i teach') ||
      normalized.includes('when did i set') ||
      normalized.includes('what are my preferences') ||
      normalized.includes('what is my profile') ||
      normalized.includes('what settings') ||
      normalized.includes('show my memory') ||
      normalized.includes('tell me about my')
    ) {
      operation = 'query';
    } else if (
      normalized.includes('when i study') ||
      normalized.includes('when i sleep') ||
      normalized.includes('whenever i') ||
      normalized.includes('remember this') ||
      normalized.includes('remember that') ||
      normalized.includes('remember for') ||
      normalized.includes('learn that') ||
      normalized.includes('learn this') ||
      normalized.includes('always let') ||
      normalized.includes('always allow')
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
      normalized.includes('restore') ||
      normalized.includes('end study') ||
      normalized.includes('end sleep') ||
      normalized.includes('end this session') ||
      normalized.includes('end this') ||
      normalized.includes('turn off this mode') ||
      normalized.includes('turn off this')
    ) {
      operation = 'deactivate';
    } else if (
      normalized.includes('going to') ||
      normalized.includes('start') ||
      normalized.includes('activate') ||
      normalized.includes('focus for') ||
      normalized.includes('keep this mode on')
    ) {
      operation = 'activate';
    } else if (
      normalized.includes('change') ||
      normalized.includes('modify') ||
      normalized.includes('set') ||
      normalized.includes('forget that') ||
      normalized.includes('forget this')
    ) {
      operation = 'modify';
    } else if (
      normalized.includes("actually, don't let") ||
      normalized.includes('actually, dont let') ||
      normalized.includes("actually don't let") ||
      normalized.includes('actually dont let') ||
      normalized.includes("don't let") ||
      normalized.includes('dont let') ||
      normalized.includes('remove ')
    ) {
      operation = ctx?.activeActivity ? 'modify' : 'teach';
    } else if (
      normalized.includes('let ') ||
      normalized.includes('allow ') ||
      normalized.includes('through')
    ) {
      // Exception / priority commands:
      // – "while I study/sleep" → session-scoped temporary override (modify)
      // – active session present → temporary override (modify)
      // – no session context and no "while" phrasing → persistent preference (teach)
      const isSessionScoped =
        normalized.includes('while i') ||
        normalized.includes('while studying') ||
        normalized.includes('while sleeping') ||
        normalized.includes('during this session');
      operation = ctx?.activeActivity || isSessionScoped ? 'modify' : 'teach';
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
    const persistence = detectPersistence(normalized);

    // WhatsApp exceptions are preference-only; surface that with requiresConfirmation.
    const hasWhatsApp = exceptions.some((e) => e.channel === 'whatsapp');

    const intent: Intent = {
      ...EMPTY_INTENT,
      activity,
      operation,
      durationMinutes,
      schedule,
      persistence,
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
