/**
 * OWNER: AAYUSH — Phase 6 (A6.1, A6.2, A6.3, A6.4, A6.6, A6.7)
 *
 * Contract and boundary tests over the screen sources.
 *
 * The project has no React Native rendering stack — no `@testing-library/react-native`, no
 * `react-test-renderer`, and jest runs in `node` — so these follow the approach D-V9 established
 * in `uiFoundation.test.ts`: read the real source files and fail loudly when a boundary is crossed
 * or a status goes missing. They are not render assertions and do not pretend to be.
 *
 * The thing they actually defend is narrow and worth stating: **a screen must not be able to
 * quietly lose a status, and must not be able to reach a device directly.** Both are easy to do by
 * accident with a plausible-looking import, and neither shows up in a passing feature test.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { ROUTES } from '../../navigation';
import { ACTION_STATUSES, ENFORCEMENT_STATUSES, STATUS_PRESENTATION } from '../../types';

const SCREENS = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(SCREENS, rel), 'utf8');

const home = read('Home/index.tsx');
const activeContext = read('ActiveContext/index.tsx');

// ---------------------------------------------------------------------------
// A6.1 / A6.2 — the live session surface shows the real thing
// ---------------------------------------------------------------------------

describe('A6.1 — the live session surface', () => {
  it('Home takes the session from outside and owns no copy of it', () => {
    // Every field it displays arrives as a prop. A screen that fetched or derived session state
    // would be a second source of truth the moment the phone changed without it noticing.
    expect(home).toMatch(/session: ContextSession \| null/);
    expect(home).toMatch(/state: ContextState/);

    // The one piece of local state is the clock, and it says why.
    const useStateCount = (home.match(/useState/g) ?? []).length;
    expect(useStateCount).toBeLessThanOrEqual(2); // the countdown, and its import
  });

  it('Home surfaces which backend is live, so a mock is never mistaken for a phone', () => {
    expect(home).toMatch(/device backend/);
    expect(home).toMatch(/backend: 'native' \| 'mock'/);
  });

  it('Active Context shows mode, state, countdown, per-action results and the way out', () => {
    for (const required of [
      'label',
      'state',
      'results',
      'priority',
      'emergency',
      'onEnd',
      'countdown',
    ]) {
      expect(activeContext).toContain(required);
    }
  });
});

// ---------------------------------------------------------------------------
// A6.6 — the vocabulary survives the design system
// ---------------------------------------------------------------------------

describe('A6.6 — no status is lost on the way to the screen', () => {
  it('uses StatusChip, which is driven by the frozen STATUS_PRESENTATION', () => {
    expect(activeContext).toContain('StatusChip');
  });

  it('does NOT use StatusRow, whose five states cannot express six', () => {
    // StatusRow is 'pending' | 'success' | 'failed' | 'idle' | 'unsupported'. Mapping an
    // ActionResult through it would collapse permission_needed, skipped and restored — three of
    // the six frozen statuses — which is exactly the rounding executionStatus.test.ts forbids.
    // Checked as IMPORT and JSX USE, not as the bare word: both files name StatusRow in a
    // comment explaining precisely why they avoid it, and a test that banned the word
    // would delete the explanation along with the mistake.
    for (const source of [activeContext, home]) {
      expect(/import\s*\{[^}]*StatusRow[^}]*\}/.test(source)).toBe(false);
      expect(/<StatusRow[\s/>]/.test(source)).toBe(false);
    }
  });

  it('every ActionStatus still has a distinct label to render', () => {
    const labels = ACTION_STATUSES.map((s) => STATUS_PRESENTATION[s].label);
    expect(new Set(labels).size).toBe(ACTION_STATUSES.length);
  });

  it('colour is never the only signal — each status carries words', () => {
    for (const status of ACTION_STATUSES) {
      expect(STATUS_PRESENTATION[status].label.trim().length).toBeGreaterThan(0);
    }
  });

  it('priority keeps its own four-state vocabulary alongside the six', () => {
    expect(activeContext).toContain('ENFORCEMENT_PRESENTATION');
    expect(ENFORCEMENT_STATUSES.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// A6.3 — no screen may reach a device directly
// ---------------------------------------------------------------------------

describe('A6.3 — start and end go through the executor, and nothing else does', () => {
  it('no screen imports a native capability, the registry, or an Android module', () => {
    for (const [name, source] of [
      ['Home', home],
      ['ActiveContext', activeContext],
    ] as const) {
      expect(`${name}:${/from '.*modules\/ally-native/.test(source)}`).toBe(`${name}:false`);
      expect(`${name}:${/from '.*native\/capabilities/.test(source)}`).toBe(`${name}:false`);
      // The registry itself is off limits too: a screen holding a device could call execute().
      expect(`${name}:${/\bcreateNativeRegistry\b/.test(source)}`).toBe(`${name}:false`);
    }
  });

  it('no screen imports the memory or policy layers', () => {
    for (const source of [home, activeContext]) {
      expect(/from '.*\/memory'/.test(source)).toBe(false);
      expect(/from '.*\/policy'/.test(source)).toBe(false);
    }
  });

  it('Home starts a context by asking the shell, never by acting itself', () => {
    // Callbacks in, no execution out. The shell owns activateFromText → startContext.
    expect(home).toMatch(/onStartStudy: \(\) => void/);
    expect(home).toMatch(/onStartSleep: \(\) => void/);
    expect(home).not.toMatch(/\bstartContext\b/);
    expect(home).not.toMatch(/\bexecutePlan\b/);
  });
});

// ---------------------------------------------------------------------------
// A6.4 — everything the demo needs is reachable
// ---------------------------------------------------------------------------

describe('A6.4 — navigation reaches every Phase 6 destination', () => {
  it('has home, active context, priority and the demoted dev tools', () => {
    expect([...ROUTES].sort()).toEqual(['activeContext', 'devtools', 'home', 'priority']);
  });

  it('Home offers a way to each of them', () => {
    expect(home).toContain('onOpenActive');
    expect(home).toContain('onOpenPriority');
    expect(home).toContain('onOpenDevTools');
  });

  it('the Phase 2 harness is no longer the entry point', () => {
    const app = readFileSync(join(SCREENS, '..', '..', 'App.tsx'), 'utf8');
    // Home is the fall-through route; the harness sits behind `devtools`.
    expect(app).toMatch(/route === 'devtools'/);
    expect(app).toContain('<HomeScreen');
  });
});

// ---------------------------------------------------------------------------
// A6.7 — errors a person can act on
// ---------------------------------------------------------------------------

describe('A6.7 — failures are explained, not dumped', () => {
  it('the frozen status labels already say what happened in plain words', () => {
    expect(STATUS_PRESENTATION.permission_needed.label).toMatch(/permission/i);
    expect(STATUS_PRESENTATION.not_supported.label).not.toMatch(/fail/i);
  });

  it('an unreadable-store failure is explained with a sentence and a next step', () => {
    expect(activeContext).toMatch(/endError/);
    expect(activeContext).toMatch(/Nothing was lost/);
  });

  it('no screen renders a raw error object or stack', () => {
    for (const source of [home, activeContext]) {
      expect(source).not.toMatch(/\.stack\b/);
      expect(source).not.toMatch(/JSON\.stringify\(\s*(err|error|e)\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// A6.1 — recovered sessions (found on SM-S928B, not in a test run)
// ---------------------------------------------------------------------------

describe('A6.1 — a session recovered after a process death tells the truth', () => {
  it('does not print a change count unconditionally', () => {
    // The bug: `results` lives in React state, so a process death empties it, and the screen
    // printed "0/0 changes applied" over a phone genuinely held at DND=priority / brightness 64.
    // The count must now be reachable ONLY when it is a real count.
    // The count text must sit on the FALSE branch of `recovered`, never on its own.
    const note = activeContext.slice(activeContext.indexOf('changes applied') - 400);
    expect(note).toContain('recovered');
    expect(note).toMatch(/recovered[\s\S]{0,200}changes applied/);
  });

  it('falls back to the persisted snapshots rather than to "Nothing yet"', () => {
    expect(activeContext).toContain('describeHeld');
    expect(activeContext).toMatch(/results\.length === 0 && held !== null/);
  });

  it('labels recovered rows Held, never Applied', () => {
    // A snapshot proves Ally captured the user's value, not that its own change succeeded.
    // Rendering these through StatusChip would manufacture an ActionStatus that never existed.
    const heldBlock = activeContext.slice(activeContext.indexOf('held.settings.map'));
    expect(heldBlock).toContain('Held');
    expect(heldBlock.slice(0, 600)).not.toContain('StatusChip');
  });

  it('the shell loads what is held on every context refresh', () => {
    const app = readFileSync(join(SCREENS, '..', '..', 'App.tsx'), 'utf8');
    expect(app).toContain('heldForSession');
    // Cleared when nothing is running, so a stale holding cannot outlive its session.
    expect(app).toMatch(/setHeld\(null\)/);
  });
});

// ---------------------------------------------------------------------------
// Office Kit — what this file does NOT cover
// ---------------------------------------------------------------------------

describe('Office Kit scope', () => {
  it('no screen claims a physical Office Kit was connected or tested', () => {
    // The hardware has not been received. Nothing in the UI may imply otherwise.
    for (const source of [home, activeContext]) {
      expect(source).not.toMatch(/office kit (connected|verified|tested)/i);
    }
  });
});
