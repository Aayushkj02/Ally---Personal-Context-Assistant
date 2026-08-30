/**
 * OWNER: DHREY — task D-V9 (Shared UI Foundation)
 *
 * The project has no React Native rendering stack (no @testing-library/react-native,
 * no react-test-renderer) and jest only matches `__tests__/**\/*.test.ts`. Per the
 * D-V9 brief, no rendering stack was installed just for this task, so these are
 * contract and static-boundary tests over the real source files rather than render
 * assertions — they still fail loudly if a boundary is crossed or a token goes missing.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { colors, radius, spacing, typography } from '../../theme';
import { ACTION_STATUSES, STATUS_PRESENTATION } from '../../types';
import type { ActionPlan, ActionResult, SessionState } from '../../types';
import { useStore } from '../../store';

const COMPONENT_NAMES = ['Text', 'Button', 'Card', 'StatusChip', 'Timer', 'PermissionRow'] as const;

const COMPONENT_DIR = join(__dirname, '..');

const BARREL = readFileSync(join(COMPONENT_DIR, 'index.ts'), 'utf8');

function sourceOf(name: string): string {
  return readFileSync(join(COMPONENT_DIR, `${name}.tsx`), 'utf8');
}

describe('D-V9 shared UI foundation', () => {
  // ── TEST 1 — component exports ─────────────────────────────────────────────
  it('DV9-1: every shared primitive is exported from components/index.ts', () => {
    for (const name of COMPONENT_NAMES) {
      expect(BARREL).toMatch(new RegExp(`export \{ ${name} \} from './${name}'`));
      // and the file it points at really defines it
      expect(sourceOf(name)).toMatch(new RegExp(`export const ${name}`));
    }
  });

  it('DV9-1b: the barrel exposes no duplicate or unexpected primitives', () => {
    const exported = [...BARREL.matchAll(/export \{ (\w+) \} from/g)].map((m) => m[1]!);
    expect(exported.sort()).toEqual([...COMPONENT_NAMES].sort());
    expect(new Set(exported).size).toBe(exported.length);
  });

  // ── TEST 2 — theme exports ─────────────────────────────────────────────────
  it('DV9-2: colors, spacing, typography and radius are publicly exported', () => {
    for (const token of [colors, spacing, typography, radius]) {
      expect(token).toBeDefined();
      expect(typeof token).toBe('object');
      expect(Object.keys(token).length).toBeGreaterThan(0);
    }
  });

  it('DV9-2b: there is one theme — components import tokens, never redefine them', () => {
    for (const name of COMPONENT_NAMES) {
      const src = sourceOf(name);
      if (name === 'Text') continue; // Text imports typography/colors only.
      // No component may declare its own palette or scale.
      expect(src).not.toMatch(/export const colors\b/);
      expect(src).not.toMatch(/export const spacing\b/);
      expect(src).not.toMatch(/export const typography\b/);
      expect(src).not.toMatch(/export const radius\b/);
    }
  });

  it('DV9-2c: components take theme tokens from src/theme, not from copies', () => {
    // Every component that styles anything pulls from the single theme module.
    for (const name of ['Button', 'Card', 'StatusChip', 'Timer', 'PermissionRow', 'Text']) {
      expect(sourceOf(name)).toMatch(/from '\.\.\/theme'/);
    }
  });

  // ── TEST 3 — status mapping ────────────────────────────────────────────────
  it('DV9-3: every ActionStatus has a presentation entry', () => {
    for (const status of ACTION_STATUSES) {
      const presentation = STATUS_PRESENTATION[status];
      expect(presentation).toBeDefined();
      expect(typeof presentation.label).toBe('string');
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(typeof presentation.tone).toBe('string');
    }
  });

  it('DV9-3b: every status tone resolves to a real colour token', () => {
    // StatusChip does `colors[tone] || colors.neutral`. Without this test a tone with
    // no matching token would silently render grey instead of failing loudly, so two
    // different statuses could look identical.
    for (const status of ACTION_STATUSES) {
      const tone = STATUS_PRESENTATION[status].tone;
      expect(Object.keys(colors)).toContain(tone);
      expect(colors[tone as keyof typeof colors]).toMatch(/^#|^rgba/);
    }
  });

  it('DV9-3c: statuses are distinguishable by text, not colour alone', () => {
    // Accessibility: the chip renders presentation.label, so a colour-blind user or a
    // screen reader still gets the status.
    const labels = ACTION_STATUSES.map((s) => STATUS_PRESENTATION[s].label);
    expect(new Set(labels).size).toBe(ACTION_STATUSES.length);

    const src = sourceOf('StatusChip');
    expect(src).toMatch(/presentation\.label/);
    expect(src).toMatch(/accessibilityLabel/);
  });

  it('DV9-3d: StatusChip uses the frozen vocabulary and invents no statuses', () => {
    const src = sourceOf('StatusChip');
    expect(src).toMatch(/STATUS_PRESENTATION/);
    expect(src).toMatch(/ActionStatus/);
    // No hand-rolled status list.
    expect(src).not.toMatch(/'applied'|'permission_needed'|'not_supported'|'restored'/);
  });

  // ── TEST 4 — store compatibility ───────────────────────────────────────────
  it('DV9-4: UI-facing runtime state matches what the store exposes', () => {
    const state = useStore.getState();

    // The types the UI renders are the frozen domain types, not UI-only copies.
    const plan: ActionPlan | null = state.latestPlan;
    const results: ActionResult[] = state.latestResults;
    const sessionState: SessionState = state.sessionState;

    expect(plan === null || typeof plan === 'object').toBe(true);
    expect(Array.isArray(results)).toBe(true);
    expect(typeof sessionState).toBe('string');

    for (const key of ['activeProfileId', 'activeSessionId', 'currentTranscript', 'error']) {
      expect(state).toHaveProperty(key);
    }
  });

  it('DV9-4b: no component reaches into the store to make decisions', () => {
    // Presentational primitives take props. Screens wire the store; primitives do not.
    for (const name of COMPONENT_NAMES) {
      expect(sourceOf(name)).not.toMatch(/useStore/);
    }
  });

  // ── TEST 5 — boundaries ────────────────────────────────────────────────────
  it('DV9-5: no component imports persistence', () => {
    for (const name of COMPONENT_NAMES) {
      const src = sourceOf(name);
      expect(src).not.toMatch(/expo-sqlite/);
      expect(src).not.toMatch(/getDatabase/);
      expect(src).not.toMatch(/Repository/);
      expect(src).not.toMatch(/from '\.\.\/memory/);
    }
  });

  it('DV9-5b: no component imports policy or computes a decision', () => {
    for (const name of COMPONENT_NAMES) {
      const src = sourceOf(name);
      expect(src).not.toMatch(/from '\.\.\/policy/);
      expect(src).not.toMatch(
        /resolveCapability|getActiveOverrides|buildActionPlan|resolvePriority/,
      );
    }
  });

  it('DV9-5c: no component imports the AI layer', () => {
    for (const name of COMPONENT_NAMES) {
      const src = sourceOf(name);
      expect(src).not.toMatch(/from '\.\.\/ai/);
      expect(src).not.toMatch(/IntentEngine|IntentValidator|FallbackParser|OllamaParser/);
    }
  });

  it('DV9-5d: no component imports native or Android implementation', () => {
    for (const name of COMPONENT_NAMES) {
      const src = sourceOf(name);
      expect(src).not.toMatch(/AllyNative/);
      expect(src).not.toMatch(/ally-native/);
      expect(src).not.toMatch(/expo-modules-core/);
      expect(src).not.toMatch(/from '\.\.\/native/);
    }
  });

  it('DV9-5e: components build on React Native primitives, not the DOM', () => {
    for (const name of COMPONENT_NAMES) {
      const src = sourceOf(name);
      expect(src).toMatch(/from 'react-native'/);
      expect(src).not.toMatch(/document\.|window\.|className=/);
    }
  });

  // ── Accessibility (STEP 21) ────────────────────────────────────────────────
  it('DV9-6: interactive primitives expose accessibility information', () => {
    const button = sourceOf('Button');
    expect(button).toMatch(/accessibilityRole="button"/);
    expect(button).toMatch(/accessibilityLabel/);
    expect(button).toMatch(/accessibilityState/);

    // "Grant" alone tells a screen-reader user nothing about which permission.
    const permissionRow = sourceOf('PermissionRow');
    expect(permissionRow).toMatch(/accessibilityLabel=\{`Grant \$\{permission\.label\}`\}/);

    const timer = sourceOf('Timer');
    expect(timer).toMatch(/accessibilityLabel/);
  });

  it('DV9-6b: Button has a touch target large enough to hit', () => {
    expect(sourceOf('Button')).toMatch(/minHeight:\s*48/);
  });
});
