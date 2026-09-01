/**
 * OWNER: DHREY
 *
 * The Priority screen. Mode-scoped lists of who may reach the user, per channel.
 *
 * DATA BOUNDARY: this screen owns NO storage. Preferences are read and written through
 * priorityRepository and reduced by resolvePriority. Local state holds only what is on
 * screen right now — never a second copy of the data.
 *
 * HONESTY: WhatsApp renders with its real `preference_only` state rather than a tick that
 * implies the phone is doing something. Enforceable channels show which contacts must be
 * STARRED, because Android has no per-individual-contact exception (ADR-111).
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PriorityEditor } from './PriorityEditor';

import type { Channel, ChannelEnforcement, PriorityPreference } from '../../types';
import { CHANNEL_ENFORCEABLE, ENFORCEMENT_PRESENTATION } from '../../types';
import { priorityRepository, resolveProfileForActivity } from '../../memory';
import { describeEnforcement, resolvePriority } from '../../policy';
import { getAllModeDefinitions } from '../../modes';
import { colors, radius, spacing, typography } from '../../theme';

/**
 * Enforcement tone -> design-system colour.
 *
 * ENFORCEMENT_PRESENTATION owns the label and the tone NAME; the theme owns what that tone
 * looks like. Keeping the join here means neither has to know about the other, and the screen
 * still cannot invent its own status colours.
 */
const TONE_COLOR: Record<string, string> = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  neutral: colors.neutral,
};

const CHANNEL_SECTIONS: { channel: Channel; title: string; placeholder: string }[] = [
  { channel: 'calls', title: 'Calls', placeholder: 'Add a contact, e.g. Mom' },
  { channel: 'sms', title: 'SMS', placeholder: 'Add a contact' },
  { channel: 'whatsapp', title: 'WhatsApp', placeholder: 'Add a contact or group' },
];

export interface PriorityScreenProps {
  /**
   * Applies the resolved preferences to the device. Injected so this screen never imports
   * the native layer directly — that stays Aayush's boundary.
   */
  onApply?: (channels: Record<Channel, boolean>) => ChannelEnforcement[] | null;
  /**
   * Opens the system contact picker and resolves with what the user chose.
   *
   * Injected for the same reason as `onApply`, and typed structurally rather than imported, so
   * this screen still never reaches the native layer. Resolves rather than rejects on cancel —
   * backing out of the picker is an ordinary thing to do, not a failure.
   *
   * `starred` is reported for display only and is never stored: Android's DND scopes to starred
   * contacts and nothing finer (ADR-111), and starring changes in Contacts at any time, so a
   * saved copy would go stale and start lying.
   */
  onPickContact?: () => Promise<{
    ok: boolean;
    displayName?: string;
    starred?: boolean;
    reason?: string;
  }>;
}

/** Study and Sleep, from the mode files. Focus was cut (ADR-004), so there is no third tab. */
const MODE_TABS = getAllModeDefinitions().map((m) => ({ key: m.modeKey, label: m.name }));

export default function PriorityScreen({ onApply, onPickContact }: PriorityScreenProps) {
  // Which tab is open and what the last Apply reported are both genuinely UI-only: nothing
  // outside this screen needs either, so neither belongs in the shared store.
  const [modeKey, setModeKey] = useState<string>(MODE_TABS[0]?.key ?? 'study');
  const [lastEnforcement, setLastEnforcement] = useState<ChannelEnforcement[] | null>(null);

  /**
   * The real profile row id, resolved from the mode key.
   *
   * NOT the mode key itself. Profiles are seeded as `profile_study` / `profile_sleep`, so a
   * screen that keyed preferences on "study" would write rows nothing else in the app could
   * find. Resolved through the memory layer's public API rather than rebuilt from a string
   * template, so the id convention stays owned by one place.
   */
  const [profileId, setProfileId] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<PriorityPreference[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const profile = await resolveProfileForActivity(modeKey);
      if (!profile) {
        setProfileId(null);
        setPrefs([]);
        setError('That context has not been set up yet.');
        return;
      }
      setProfileId(profile.id);
      setPrefs(await priorityRepository.listForProfile(profile.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read saved preferences.');
    }
  }, [modeKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resolved = resolvePriority(profileId ?? '', prefs);
  const enforcement = describeEnforcement(resolved, lastEnforcement);

  /**
   * Whether the device has actually been asked yet.
   *
   * `describeEnforcement` is right to call a configured-but-unreported channel `failed` — that is
   * the integration path, where a device report came back and simply omitted the channel, and
   * "never assume it worked" is exactly the rule that should hold there.
   *
   * This screen passes `null`, which means something else entirely: Apply has not been pressed, so
   * nothing has been attempted. Rendering that as a red "Failed" told the user Android had
   * rejected their contacts when Ally had not yet said a word to it. The function is fine; the
   * caller was conflating "not asked" with "asked and got silence".
   */
  const applied = lastEnforcement !== null;

  const apply = () => {
    if (!onApply) return;
    setLastEnforcement(onApply(resolved.channels));
  };

  const starList = resolved.requiresStarring.join(', ');
  const starVerb = resolved.requiresStarring.length === 1 ? 'is' : 'are';

  return (
    <ScrollView contentContainerStyle={s.root}>
      <Text style={s.h1}>Priority</Text>

      <View style={s.row}>
        {MODE_TABS.map((m) => (
          <Pressable
            key={m.key}
            onPress={() => setModeKey(m.key)}
            style={[s.chip, modeKey === m.key && s.chipOn]}
          >
            <Text style={[s.chipText, modeKey === m.key && s.chipTextOn]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {CHANNEL_SECTIONS.map(({ channel, title, placeholder }) => (
        <PriorityEditor
          key={channel}
          channel={channel}
          title={title}
          placeholder={placeholder}
          profileId={profileId}
          prefs={prefs}
          onPickContact={onPickContact}
          status={enforcement.find((e) => e.channel === channel)}
          applied={applied}
          onReload={reload}
          onError={setError}
        />
      ))}

      {resolved.requiresStarring.length > 0 ? (
        <View style={s.warn}>
          <Text style={s.warnTitle}>Star these contacts on your phone</Text>
          <Text style={s.warnBody}>
            {`Android has no per-contact exception — it can only allow starred contacts. If ${starList} ${starVerb} not starred in Contacts, they will still be silenced.`}
          </Text>
        </View>
      ) : null}

      <View style={s.section}>
        <Text style={s.h2}>Emergency Calls</Text>
        <Text style={s.note}>
          {
            '4+ calls from the same person within 10 minutes is treated as urgent. Ally detects this from your call history and tells you about it. The phone ringing through is handled by Android’s own repeat-caller setting, which uses a 15-minute window.'
          }
        </Text>
      </View>

      {onApply ? (
        <Pressable style={s.apply} onPress={apply}>
          <Text style={s.applyText}>Apply to phone</Text>
        </Pressable>
      ) : null}
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
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: {
    color: colors.textSecondary,
    fontWeight: typography.weight.semiBold,
    fontSize: typography.size.md,
  },
  chipTextOn: { color: colors.textInverse },
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgeText: {
    color: colors.textInverse,
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
  },
  note: { ...typography.presets.caption, color: colors.textSecondary },
  empty: { ...typography.presets.caption, color: colors.textTertiary, fontStyle: 'italic' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  itemMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  tick: {
    color: colors.textTertiary,
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
    width: 28,
  },
  tickOn: { color: colors.success },
  itemText: { ...typography.presets.body, color: colors.textPrimary },
  itemTextOff: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  tag: { fontSize: typography.size.xs, color: colors.textTertiary },
  remove: { fontSize: typography.size.sm, color: colors.danger },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: typography.size.md,
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  addBtnText: {
    color: colors.textInverse,
    fontWeight: typography.weight.bold,
    fontSize: typography.size.md,
  },
  // A warning, not a failure: the preference IS saved, it just will not fire unstarred.
  // Carried by a warning-coloured rule rather than a filled block, which the light palette
  // would otherwise turn into something that reads like an error.
  warn: {
    backgroundColor: colors.surfaceElevated,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  warnTitle: {
    color: colors.textPrimary,
    fontWeight: typography.weight.bold,
    fontSize: typography.size.md,
  },
  warnBody: { ...typography.presets.caption, color: colors.textSecondary },
  error: { fontSize: typography.size.sm, color: colors.danger },
  apply: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  applyText: {
    color: colors.textInverse,
    fontWeight: typography.weight.bold,
    fontSize: typography.size.lg,
  },
});
