import { describe, it, expect } from '@jest/globals';
import { getModeDefinition, getAllModeDefinitions, MODES } from '../index';
import { isCapability } from '../../types';

describe('Mode Definitions', () => {
  it('loads study and sleep modes', () => {
    const modes = getAllModeDefinitions();
    expect(modes.length).toBeGreaterThanOrEqual(2);
    expect(MODES.study).toBeDefined();
    expect(MODES.sleep).toBeDefined();
  });

  it('validates study mode structure', () => {
    const study = getModeDefinition('study');
    expect(study).not.toBeNull();
    if (study) {
      expect(study.modeKey).toBe('study');
      expect(study.defaults.length).toBeGreaterThan(0);
      study.defaults.forEach((action) => {
        expect(isCapability(action.capability)).toBe(true);
        expect(action.reason).toBeTruthy();
      });
    }
  });

  it('validates sleep mode structure', () => {
    const sleep = getModeDefinition('sleep');
    expect(sleep).not.toBeNull();
    if (sleep) {
      expect(sleep.modeKey).toBe('sleep');
      expect(sleep.defaults.length).toBeGreaterThan(0);
      sleep.defaults.forEach((action) => {
        expect(isCapability(action.capability)).toBe(true);
        expect(action.reason).toBeTruthy();
      });
    }
  });
});
