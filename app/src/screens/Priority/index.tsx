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
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Channel, ChannelEnforcement, PriorityPreference } from '../../types';
import { CHANNEL_ENFORCEABLE, ENFORCEMENT_PRESENTATION } from '../../types';
import { priorityRepository } from '../../memory';
import { describeEnforcement, resolvePriority } from '../../policy';
import { MODES, useAppStore } from '../../store';
import { theme, toneColor } from '../../theme';

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
}

export default function PriorityScreen({ onApply }: PriorityScreenProps) {
  const mode = useAppStore((st) => st.mode);
  const setMode = useAppStore((st) => st.setMode);
  const lastEnforcement = useAppStore((st) => st.lastEnforcement);
  const setLastEnforcement = useAppStore((st) => st.setLastEnforcement);

  const [prefs, setPrefs] = useState<PriorityPreference[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPrefs(await priorityRepository.listForProfile(mode));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read saved preferences.');
    }
  }, [mode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resolved = resolvePriority(mode, prefs);
  const enforcement = describeEnforcement(resolved, lastEnforcement);

  const add = async (channel: Channel) => {
    const subject = (drafts[channel] ?? '').trim();
    if (!subject) return;
    try {
      await priorityRepository.addPreference({
        profileId: mode,
        channel,
        subject,
        subjectKind: channel === 'whatsapp' && /group/i.test(subject) ? 'contactGroup' : 'contact',
      });
      setDrafts((d) => ({ ...d, [channel]: '' }));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

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
        {MODES.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => setMode(m.id)}
            style={[s.chip, mode === m.id && s.chipOn]}
          >
            <Text style={[s.chipText, mode === m.id && s.chipTextOn]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {CHANNEL_SECTIONS.map(({ channel, title, placeholder }) => {
        const rows = prefs.filter((p) => p.channel === channel);
        const status = enforcement.find((e) => e.channel === channel);
        // An empty enforceable channel gets no badge at all. "Not supported on this device"
        // is a claim about the phone, and saying it about an empty list is simply false.
        const showBadge = rows.length > 0 || !CHANNEL_ENFORCEABLE[channel];
        const presentation = status && showBadge ? ENFORCEMENT_PRESENTATION[status.status] : null;

        return (
          <View key={channel} style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.h2}>{title}</Text>
              {presentation ? (
                <View style={[s.badge, { backgroundColor: toneColor(presentation.tone) }]}>
                  <Text style={s.badgeText}>{presentation.label}</Text>
                </View>
              ) : null}
            </View>

            {CHANNEL_ENFORCEABLE[channel] ? null : (
              <Text style={s.note}>
                Ally remembers this. Android gives no app a way to control WhatsApp notifications,
                so your phone will not change.
              </Text>
            )}

            {rows.length === 0 ? <Text style={s.empty}>No one added yet.</Text> : null}

            {rows.map((p) => (
              <View key={p.id} style={s.item}>
                <Pressable
                  style={s.itemMain}
                  onPress={async () => {
                    await priorityRepository.setEnabled(p.id, !p.enabled);
                    await reload();
                  }}
                >
                  <Text style={[s.tick, p.enabled && s.tickOn]}>{p.enabled ? 'ON' : 'off'}</Text>
                  <Text style={[s.itemText, !p.enabled && s.itemTextOff]}>{p.subject}</Text>
                  {p.subjectKind === 'contactGroup' ? <Text style={s.tag}>group</Text> : null}
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await priorityRepository.removePreference(p.id);
                    await reload();
                  }}
                >
                  <Text style={s.remove}>Remove</Text>
                </Pressable>
              </View>
            ))}

            <View style={s.addRow}>
              <TextInput
                style={s.input}
                placeholder={placeholder}
                placeholderTextColor={theme.color.textFaint}
                value={drafts[channel] ?? ''}
                onChangeText={(t) => setDrafts((d) => ({ ...d, [channel]: t }))}
                onSubmitEditing={() => void add(channel)}
              />
              <Pressable style={s.addBtn} onPress={() => void add(channel)}>
                <Text style={s.addBtnText}>Add</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

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
    padding: theme.space.xl,
    paddingTop: 56,
    gap: theme.space.md,
    backgroundColor: theme.color.bg,
    minHeight: '100%',
  },
  h1: { fontSize: theme.font.hero, fontWeight: '700', color: theme.color.text },
  h2: { fontSize: theme.font.lg, fontWeight: '700', color: theme.color.text },
  row: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
  },
  chipOn: { backgroundColor: theme.color.accent },
  chipText: { color: theme.color.textDim, fontWeight: '600', fontSize: theme.font.base },
  chipTextOn: { color: '#FFFFFF' },
  section: {
    marginTop: theme.space.lg,
    gap: theme.space.sm,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    padding: theme.space.lg,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.sm,
  },
  badge: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
  },
  badgeText: { color: '#FFFFFF', fontSize: theme.font.sm, fontWeight: '700' },
  note: { color: theme.color.textFaint, fontSize: theme.font.sm, lineHeight: 18 },
  empty: { color: theme.color.textFaint, fontSize: theme.font.sm, fontStyle: 'italic' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space.sm,
  },
  itemMain: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, flex: 1 },
  tick: { color: theme.color.textFaint, fontSize: theme.font.sm, fontWeight: '700', width: 28 },
  tickOn: { color: '#4ADE80' },
  itemText: { color: theme.color.text, fontSize: theme.font.base },
  itemTextOff: { color: theme.color.textFaint, textDecorationLine: 'line-through' },
  tag: { color: theme.color.textFaint, fontSize: theme.font.sm },
  remove: { color: '#E5726B', fontSize: theme.font.sm },
  addRow: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.sm },
  input: {
    flex: 1,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    color: theme.color.text,
    fontSize: theme.font.base,
  },
  addBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.lg,
    justifyContent: 'center',
  },
  addBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: theme.font.base },
  warn: {
    backgroundColor: '#3A2E12',
    borderRadius: theme.radius.md,
    padding: theme.space.lg,
    gap: theme.space.xs,
  },
  warnTitle: { color: theme.color.text, fontWeight: '700', fontSize: theme.font.base },
  warnBody: { color: '#D9C9A3', fontSize: theme.font.sm, lineHeight: 18 },
  error: { color: '#E5726B', fontSize: theme.font.sm },
  apply: {
    marginTop: theme.space.lg,
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    padding: theme.space.lg,
    alignItems: 'center',
  },
  applyText: { color: '#FFFFFF', fontWeight: '700', fontSize: theme.font.lg },
});
