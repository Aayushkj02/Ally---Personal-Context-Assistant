/**
 * OWNER: AAYUSH — task A-V9 / A-V10
 *
 * What is running right now, what it did to the phone, and the way out of it.
 *
 * NOT A SECOND SOURCE OF TRUTH. Everything on this screen is passed in: the session comes from
 * Dhrey's `getActiveContext()`, the results from the executor, the priority rows from the
 * coordinator. The screen owns exactly one piece of state — the ticking clock — because a
 * countdown is a rendering concern and nothing else needs it. It decides no policy, reads no
 * database, and touches no Android API.
 *
 * STATUS IS NEVER ROUNDED (A-V10). Every row renders through STATUS_PRESENTATION or
 * ENFORCEMENT_PRESENTATION, which are the frozen single sources of truth for those labels, so a
 * screen cannot quietly call `not_supported` a failure or `partial` a success. The plan headline
 * is derived from the counts, never from "did anything throw".
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { StatusChip } from '../../components';
import type { ActionResult, ChannelEnforcement, ContextSession } from '../../types';
import { ENFORCEMENT_PRESENTATION, STATUS_PRESENTATION } from '../../types';
import type { ContextState, EmergencyStatus } from '../../actions';
import { describeEmergency } from '../../actions';
import { colors, radius, spacing, typography } from '../../theme';

const TONE_COLOR: Record<string, string> = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  neutral: colors.neutral,
};

/** Plain-language headline per context state. Never "Success" for a PARTIAL plan. */
const STATE_COPY: Record<ContextState, { title: string; tone: string }> = {
  READY: { title: 'Ready', tone: 'neutral' },
  ACTIVE: { title: 'Active', tone: 'success' },
  PARTIAL: { title: 'Partly applied', tone: 'warning' },
  ERROR: { title: 'Nothing was applied', tone: 'danger' },
  IDLE: { title: 'Ended', tone: 'neutral' },
};

export interface ActiveContextScreenProps {
  /** The running session, from Dhrey's memory layer. Null when nothing is active. */
  session: ContextSession | null;
  /** Display name for the context, e.g. "Study". */
  label: string;
  state: ContextState;
  results: ActionResult[];
  /**
   * Why each change was made, positionally aligned with `results` (A4.2). Comes from
   * `startContext().explained`; absent for a restore, which is driven by snapshots rather than
   * by a plan and therefore has no reason to give.
   */
  reasons?: readonly (string | null)[];
  priority: ChannelEnforcement[] | null;
  emergency: EmergencyStatus | null;
  /**
   * Set when ending could not even be attempted — the snapshots were unreadable. There are no
   * result rows in that case, so this sentence is all the user has, and saying nothing would
   * leave them looking at a phone Ally is still holding.
   */
  endError?: string | null;
  busy?: boolean;
  onEnd: () => void;
  onCheckEmergency: () => void;
  onBack: () => void;
}

/** mm:ss remaining, or null for an open-ended context. */
function remaining(endsAt: number | null, now: number): string | null {
  if (endsAt === null) return null;
  const ms = Math.max(0, endsAt - now);
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function ActiveContextScreen({
  session,
  label,
  state,
  results,
  reasons,
  priority,
  emergency,
  endError = null,
  busy = false,
  onEnd,
  onCheckEmergency,
  onBack,
}: ActiveContextScreenProps) {
  // The only local state on this screen, and only because a countdown has to re-render.
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

  const applied = results.filter((r) => r.status === 'applied').length;
  const copy = STATE_COPY[state];

  if (!session) {
    return (
      <ScrollView contentContainerStyle={s.root}>
        <Text style={s.h1}>No context running</Text>
        <Text style={s.note}>
          Your phone is in its own state. Nothing of yours is being held by Ally.
        </Text>
        <Pressable style={s.secondary} onPress={onBack}>
          <Text style={s.secondaryText}>Back</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.root}>
      <Text style={s.h1}>{label}</Text>

      <View style={s.headRow}>
        <View style={[s.badge, { backgroundColor: TONE_COLOR[copy.tone] ?? colors.neutral }]}>
          <Text style={s.badgeText}>{copy.title}</Text>
        </View>
        {countdown ? <Text style={s.countdown}>{countdown} left</Text> : null}
      </View>

      <Text style={s.note}>
        {applied}/{results.length} changes applied · session {session.status.toLowerCase()}
      </Text>

      {/* A-V10: one row per action, in its own truthful status. */}
      <View style={s.card}>
        <Text style={s.h2}>What Ally changed</Text>
        {results.length === 0 ? <Text style={s.empty}>Nothing yet.</Text> : null}
        {results.map((r, i) => {
          return (
            <View key={`${r.capability}-${i}`} style={s.row}>
              <View style={s.rowHead}>
                <Text style={s.rowTitle}>{r.capability}</Text>
                {/*
                  A6.6: the design system's own chip, which takes `ActionStatus` and renders
                  through the frozen STATUS_PRESENTATION — so all six statuses survive.
                  `StatusRow` is deliberately NOT used: its five states cannot express
                  `permission_needed`, `skipped` or `restored`, and collapsing three of six is
                  exactly the rounding executionStatus.test.ts exists to prevent.
                */}
                <StatusChip status={r.status} />
              </View>
              <Text style={s.rowDetail}>
                {String(r.beforeValue)} → {String(r.afterValue)}
              </Text>
              <Text style={s.rowMessage}>{r.message}</Text>
              {/* A4.2: where the value came from, verbatim from the plan. Rendered separately
                  from the message because they answer different questions — the message says
                  what the phone did, this says why Ally asked for it. */}
              {reasons?.[i] ? <Text style={s.rowReason}>{reasons[i]}</Text> : null}
            </View>
          );
        })}
      </View>

      {/* Priority keeps its own four-state vocabulary — never folded into the plan status. */}
      {priority && priority.length > 0 ? (
        <View style={s.card}>
          <Text style={s.h2}>Who can reach you</Text>
          {priority.map((c) => {
            const p = ENFORCEMENT_PRESENTATION[c.status];
            return (
              <View key={c.channel} style={s.row}>
                <View style={s.rowHead}>
                  <Text style={s.rowTitle}>{c.channel}</Text>
                  <View style={[s.pill, { backgroundColor: TONE_COLOR[p.tone] ?? colors.neutral }]}>
                    <Text style={s.pillText}>{p.label}</Text>
                  </View>
                </View>
                <Text style={s.rowMessage}>{c.message}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.h2}>Urgent calls</Text>
        <Text style={s.note}>
          {emergency
            ? describeEmergency(emergency)
            : 'Ally can check whether someone has been calling repeatedly.'}
        </Text>
        <Pressable style={s.secondary} onPress={onCheckEmergency}>
          <Text style={s.secondaryText}>Check recent calls</Text>
        </Pressable>
      </View>

      {endError ? (
        <View style={s.errorCard}>
          <Text style={s.errorText}>{endError}</Text>
          <Text style={s.rowMessage}>
            Nothing was lost. Try ending again — reopening Ally first is what has fixed this before.
          </Text>
        </View>
      ) : null}

      <Pressable style={[s.end, busy && s.endBusy]} onPress={onEnd} disabled={busy}>
        <Text style={s.endText}>{busy ? 'Putting your phone back…' : `End ${label}`}</Text>
      </Pressable>

      <Pressable style={s.secondary} onPress={onBack}>
        <Text style={s.secondaryText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {
    padding: spacing.xl,
    paddingTop: 56,
    gap: spacing.md,
    backgroundColor: colors.background,
    minHeight: '100%',
  },
  h1: { ...typography.presets.h1, color: colors.textPrimary },
  h2: { ...typography.presets.h3, color: colors.textPrimary },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  countdown: { ...typography.presets.bodyMedium, color: colors.textSecondary },
  note: { ...typography.presets.caption, color: colors.textSecondary },
  empty: { ...typography.presets.caption, color: colors.textTertiary, fontStyle: 'italic' },
  card: {
    marginTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { gap: 2, paddingVertical: spacing.xs },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { ...typography.presets.bodyMedium, color: colors.textPrimary },
  rowDetail: { fontSize: typography.size.sm, color: colors.textSecondary },
  rowMessage: { fontSize: typography.size.xs, color: colors.textTertiary },
  rowReason: { fontSize: typography.size.xs, color: colors.textTertiary, fontStyle: 'italic' },
  badge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  badgeText: {
    color: colors.textInverse,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
  },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: {
    color: colors.textInverse,
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
  },
  end: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  endBusy: { backgroundColor: colors.neutral },
  errorCard: {
    marginTop: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { ...typography.presets.bodyMedium, color: colors.danger },
  endText: {
    color: colors.textInverse,
    fontWeight: typography.weight.bold,
    fontSize: typography.size.lg,
  },
  secondary: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  secondaryText: { color: colors.textPrimary, fontWeight: typography.weight.semiBold },
});
