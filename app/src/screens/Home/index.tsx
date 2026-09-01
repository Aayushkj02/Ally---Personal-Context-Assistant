/**
 * OWNER: AAYUSH — task A6.1 / A6.2 / A6.6
 *
 * The demo path. What someone sees when they open Ally.
 *
 * REPLACES THE PHASE 2 HARNESS AS THE WAY IN. `DeviceHarness` was scaffolding: every capability
 * exposed as a button, raw probe output, three ways to do the same thing. It was the right tool
 * for proving the device layer and the wrong thing to show anyone. It has not been deleted — it
 * moved behind the `devtools` route, because the probes are still how a stuck phone gets
 * diagnosed and throwing them away to tidy up would cost more than it saves.
 *
 * PRESENTATIONAL. Like ActiveContext, this screen owns no state beyond a ticking clock and
 * decides nothing. Whether a context is running comes from Dhrey's `getActiveContext()`; starting
 * one runs the real Intent → Policy → ActionPlan → ContextCoordinator path through the shell.
 * There is no button here that touches an Android API directly, and there is deliberately no
 * shortcut that skips the executor (A6.3).
 *
 * DESIGN SYSTEM, WHERE IT IS LOSSLESS. `Card`, `Text`, `Button`, `ModeIndicator` and `Timer` are
 * Dhrey's and are used as-is. `StatusRow` is NOT used anywhere in this screen or ActiveContext:
 * its five states cannot express `permission_needed`, `skipped` or `restored`, so mapping an
 * ActionResult through it would silently collapse three of the six frozen statuses. `StatusChip`
 * is used instead — it takes `ActionStatus` and renders through `STATUS_PRESENTATION`, so nothing
 * is lost.
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, ModeIndicator, Text } from '../../components';
import { colors, spacing } from '../../theme';
import type { ContextSession } from '../../types';
import type { ContextState } from '../../actions';

/** Plain-language headline per context state. Never "Success" for a PARTIAL plan. */
const STATE_COPY: Record<ContextState, string> = {
  READY: 'Getting ready',
  ACTIVE: 'Active',
  PARTIAL: 'Partly applied',
  ERROR: 'Nothing was applied',
  IDLE: 'Ended',
};

export interface HomeScreenProps {
  /** The running session, from Dhrey's memory layer. Null when nothing is active. */
  session: ContextSession | null;
  /** Display name for the running context, e.g. "study". */
  label: string;
  state: ContextState;
  /** True while a start or end is in flight, so the controls can say so. */
  busy?: boolean;
  /** Which device backend is live. Surfaced so a mock is never mistaken for a phone (ADR-007). */
  backend: 'native' | 'mock';
  deviceLine?: string | null;
  onStartStudy: () => void;
  onStartSleep: () => void;
  onOpenActive: () => void;
  onOpenPriority: () => void;
  onOpenDevTools: () => void;
}

/** "1h 57m", or null for an open-ended context. */
function remaining(endsAt: number | null, now: number): string | null {
  if (endsAt === null) return null;
  const ms = Math.max(0, endsAt - now);
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m remaining` : `${mins}m remaining`;
}

export default function HomeScreen({
  session,
  label,
  state,
  busy = false,
  backend,
  deviceLine,
  onStartStudy,
  onStartSleep,
  onOpenActive,
  onOpenPriority,
  onOpenDevTools,
}: HomeScreenProps) {
  // The only local state, and only because a countdown has to re-render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session || session.endsAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  const countdown = useMemo(
    () => (session ? remaining(session.endsAt, now) : null),
    [session, now],
  );

  return (
    <ScrollView contentContainerStyle={s.root}>
      <Text preset="h1">Ally</Text>
      <Text preset="caption" color="textSecondary">
        {deviceLine ?? 'No device information'}
      </Text>
      {/* The backend is surfaced, not hidden: a mock must never be mistaken for a real phone. */}
      <Text preset="caption" color={backend === 'native' ? 'success' : 'warning'}>
        device backend: {backend}
      </Text>

      {session ? (
        <Card variant="highlight" elevated style={s.card}>
          <View style={s.headRow}>
            <ModeIndicator mode={label} isActive={state === 'ACTIVE' || state === 'PARTIAL'} />
            <Text preset="bodyMedium" color="textSecondary">
              {STATE_COPY[state]}
            </Text>
          </View>

          <Text preset="h3">{countdown ?? 'Open-ended'}</Text>
          <Text preset="caption" color="textSecondary">
            Ally is holding some of your settings. They go back when this ends.
          </Text>

          <Button label="See what Ally changed" onPress={onOpenActive} style={s.action} />
        </Card>
      ) : (
        <Card style={s.card}>
          <Text preset="h3">Nothing running</Text>
          <Text preset="caption" color="textSecondary">
            Your phone is in its own state. Nothing of yours is being held by Ally.
          </Text>

          <Button
            label={busy ? 'Starting…' : 'Study for two hours'}
            disabled={busy}
            onPress={onStartStudy}
            style={s.action}
          />
          <Button
            label={busy ? 'Starting…' : 'Sleep, wake me at 7 on weekdays'}
            variant="secondary"
            disabled={busy}
            onPress={onStartSleep}
            style={s.action}
          />
          <Text preset="caption" color="textTertiary">
            Both run the real sentence through Intent → Policy → ActionPlan → the executor. There is
            no shortcut here that touches Android directly.
          </Text>
        </Card>
      )}

      <Card style={s.card}>
        <Text preset="h3">Who can reach you</Text>
        <Text preset="caption" color="textSecondary">
          Calls and messages Ally can genuinely let through, and the ones it can only remember.
        </Text>
        <Button
          label="Priority contacts"
          variant="secondary"
          onPress={onOpenPriority}
          style={s.action}
        />
      </Card>

      {/*
        The Phase 2 harness, kept and demoted rather than deleted. It is still the fastest way to
        diagnose a phone that is behaving oddly, and it is no longer the first thing anyone sees.
      */}
      <Button
        label="Developer tools"
        variant="secondary"
        onPress={onOpenDevTools}
        style={s.devtools}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {
    padding: spacing.xl,
    paddingTop: 56,
    gap: spacing.sm,
    backgroundColor: colors.background,
    minHeight: '100%',
  },
  card: { marginTop: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  action: { marginTop: spacing.sm },
  devtools: { marginTop: spacing.xl, opacity: 0.7 },
});
