/**
 * OWNER: AAYUSH — SINGLE OWNER, no exceptions.
 *
 * Route map for the app. Every screen from every developer is registered here, which makes this
 * the classic three-way conflict file. Rule: only Aayush edits it, and only one person adds
 * routes per phase. Need a route? Ask him; do not add it yourself.
 *
 * NOT REACT NAVIGATION (ADR-121). The Phase 0 comment planned a React Navigation stack, and this
 * is deliberately not that. Phase 2 has three destinations, no nested stacks, no gestures, no
 * deep-link parameters and no header chrome to configure — and pulling in @react-navigation plus
 * its screens/safe-area/gesture-handler peers would mean new native dependencies and a rebuild,
 * this late, for a surface a switch statement covers. When Phase 3 adds screens that genuinely
 * need a stack, this file is the only thing that changes: everything above it navigates through
 * `useRoute()`, not through a library type.
 */

import { useCallback, useState } from 'react';

export const ROUTES = ['home', 'activeContext', 'priority'] as const;
export type Route = (typeof ROUTES)[number];

export interface Navigator {
  route: Route;
  navigate: (to: Route) => void;
  /** Back to the harness/home surface. */
  home: () => void;
}

/**
 * The whole navigator.
 *
 * Route is LOCAL UI STATE and belongs nowhere else. Which screen is on top is not a fact about
 * the session, so it must not go into Dhrey's store — a second copy there would immediately
 * disagree with this one the first time a screen changed without a session change.
 */
export function useRoute(initial: Route = 'home'): Navigator {
  const [route, setRoute] = useState<Route>(initial);

  const navigate = useCallback((to: Route) => setRoute(to), []);
  const home = useCallback(() => setRoute('home'), []);

  return { route, navigate, home };
}
