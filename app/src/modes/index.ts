import studyMode from './study.json';
import sleepMode from './sleep.json';
import type { Capability, CapabilityValue } from '../types';

export interface ModeDefaultAction {
  capability: Capability;
  value: CapabilityValue;
  needsSnapshot: boolean;
  requiredPermission: 'notification_policy' | 'write_settings' | 'microphone' | 'exact_alarm' | null;
  reason: string;
}

export interface ModeDefinition {
  modeKey: string;
  name: string;
  description: string;
  defaultDurationMinutes: number | null;
  restoreOnEnd: boolean;
  defaults: ModeDefaultAction[];
  defaultExceptions: Array<{
    type: 'contact' | 'contactGroup';
    value: string;
    effect: 'allow' | 'block';
  }>;
  phrases: {
    activate: string[];
    deactivate: string[];
  };
}

export const MODES: Record<string, ModeDefinition> = {
  study: studyMode as ModeDefinition,
  sleep: sleepMode as ModeDefinition,
};

export function getModeDefinition(key: string): ModeDefinition | null {
  const normalizedKey = key.trim().toLowerCase();
  return MODES[normalizedKey] ?? null;
}

export function getAllModeDefinitions(): ModeDefinition[] {
  return Object.values(MODES);
}
