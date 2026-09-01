/**
 * OWNER: AAYUSH — task A7.
 *
 * Tests for the only part of Focus Guard that can be tested without a phone: the pure function
 * deciding what Ally is ALLOWED TO SAY about it.
 *
 * WHAT THESE TESTS ARE ACTUALLY PROTECTING. Not arithmetic — wording. The whole feature is a
 * redirect dressed as a restriction, and the one way it becomes dishonest is by someone editing a
 * string until it implies Android suspended the app. `never claims a block` below is the real test
 * in this file; the rest exist to make sure every reachable state has a sentence for that test to
 * check.
 *
 * The device behaviour itself — whether the redirect is fast enough to be usable — cannot be
 * asserted here and was measured on the S24 Ultra instead. See docs/DEVICE_NOTES.md. A passing
 * suite is not evidence the feature works on a phone, which is the standing rule for every
 * capability in this project.
 */

// The bridge is absent in a Node test process. Mocked explicitly rather than left to chance, so a
// failure here is about the logic under test and not about `expo` resolving.
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

import {
  DEMO_RESTRICTED_APPS,
  focusGuardPresentation,
  type FocusGuardNativeStatus,
} from '../FocusGuard';

/** A granted, connected, idle guard. Each test overrides only the field it is about. */
function status(over: Partial<FocusGuardNativeStatus> = {}): FocusGuardNativeStatus {
  return {
    hasAccess: true,
    serviceConnected: true,
    available: true,
    active: false,
    guarding: false,
    expiresAt: 0,
    packages: [...DEMO_RESTRICTED_APPS],
    redirects: 0,
    lastPackage: null,
    lastLabel: null,
    lastAt: null,
    ...over,
  };
}

describe('DEMO_RESTRICTED_APPS', () => {
  it('is a small configurable list, not the user own data', () => {
    expect(DEMO_RESTRICTED_APPS).toHaveLength(2);
    expect(DEMO_RESTRICTED_APPS.map((a) => a.package)).toEqual([
      'com.instagram.android',
      'com.supercell.clashroyale',
    ]);
  });

  it('carries a label for every package, because native never resolves one', () => {
    // The label is what the toast says. A missing one would surface as a raw package name on
    // screen, and resolving it natively would mean asking for package-visibility permission.
    for (const app of DEMO_RESTRICTED_APPS) {
      expect(app.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('focusGuardPresentation', () => {
  it('says so plainly when there is no phone', () => {
    const p = focusGuardPresentation(null);
    expect(p.guarding).toBe(false);
    expect(p.actionLabel).toBeNull();
    expect(p.headline).toMatch(/real phone/i);
  });

  it('offers the settings route when access has never been granted', () => {
    const p = focusGuardPresentation(status({ hasAccess: false, serviceConnected: false }));
    expect(p.tone).toBe('warning');
    expect(p.actionLabel).not.toBeNull();
    expect(p.guarding).toBe(false);
    // The user has to be told the apps WILL open, or an unavailable guard reads as a working one.
    expect(p.detail).toMatch(/open normally/i);
  });

  /**
   * The state a single `available` boolean would have hidden.
   *
   * Granted but not bound is reachable — right after the toggle is flipped, and after Android
   * stops the service while leaving the grant in place. Telling this user to "grant access" sends
   * them to a switch that is already on.
   */
  it('distinguishes granted-but-not-running from never-granted', () => {
    const never = focusGuardPresentation(status({ hasAccess: false, serviceConnected: false }));
    const stopped = focusGuardPresentation(status({ serviceConnected: false }));

    expect(stopped.tone).toBe('warning');
    expect(stopped.guarding).toBe(false);
    expect(stopped.headline).not.toEqual(never.headline);
    expect(stopped.detail).toMatch(/already|granted/i);
    expect(stopped.detail).toMatch(/off and on/i);
  });

  it('names the apps it would restrict before Study Mode starts', () => {
    const p = focusGuardPresentation(status());
    expect(p.guarding).toBe(false);
    expect(p.headline).toMatch(/ready/i);
    expect(p.detail).toContain('Instagram');
    expect(p.detail).toContain('Clash Royale');
  });

  it('reports guarding with nothing opened yet', () => {
    const p = focusGuardPresentation(status({ active: true, guarding: true }));
    expect(p.tone).toBe('success');
    expect(p.guarding).toBe(true);
    // Deliberately NOT "nothing has been opened": Ally knows its own redirect count, not what
    // the user did on the phone while the service was unbound. See FocusGuard.ts.
    expect(p.detail).toMatch(/no redirects yet/i);
    expect(p.detail).not.toMatch(/nothing has been opened/i);
  });

  it('names the last app it sent the user home from', () => {
    const p = focusGuardPresentation(
      status({
        active: true,
        guarding: true,
        redirects: 1,
        lastPackage: 'com.instagram.android',
        lastLabel: 'Instagram',
        lastAt: 1_700_000_000_000,
      }),
    );
    expect(p.detail).toMatch(/last sent home from Instagram/i);
  });

  /**
   * `active` is what the user asked for; `guarding` is what is happening. An expired session
   * leaves the first true and the second false, and the UI must follow the second — otherwise a
   * study session that ran out an hour ago still claims to be restricting apps.
   */
  it('follows guarding, not the stored flag, when a session has expired', () => {
    const p = focusGuardPresentation(
      status({ active: true, guarding: false, expiresAt: 1_700_000_000_000 }),
    );
    expect(p.guarding).toBe(false);
    expect(p.headline).toMatch(/ready/i);
  });

  /**
   * THE ONE THAT MATTERS.
   *
   * Ally presses Home after the app is already on screen. Android suspends nothing — it cannot,
   * for an ordinary install (SUSPEND_APPS is signature|verifier|role, and device-owner is
   * unreachable without a factory reset). So no string in any state may use the vocabulary of
   * blocking or suspension, in either direction.
   */
  it('never claims a block or a suspension in any reachable state', () => {
    const states = [
      null,
      status({ hasAccess: false, serviceConnected: false }),
      status({ serviceConnected: false }),
      status(),
      status({ active: true, guarding: true }),
      status({ active: true, guarding: true, lastLabel: 'Instagram', redirects: 3 }),
      status({ active: true, guarding: false, expiresAt: 1 }),
      status({ packages: [] }),
    ];

    for (const s of states) {
      const p = focusGuardPresentation(s);
      const copy = `${p.headline} ${p.detail} ${p.actionLabel ?? ''}`;
      expect(copy).not.toMatch(/block/i);
      expect(copy).not.toMatch(/suspend/i);
      expect(copy).not.toMatch(/prevent/i);
    }
  });
});
