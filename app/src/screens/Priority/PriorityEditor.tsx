import React, { useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { Card, Button, Text, ModeIndicator, StatusChip } from '../../components';
import { colors, spacing, radius } from '../../theme';
import type { Channel, PriorityPreference, ChannelEnforcement } from '../../types';
import { CHANNEL_ENFORCEABLE, ENFORCEMENT_PRESENTATION } from '../../types';
import { priorityRepository } from '../../memory';

export interface PriorityEditorProps {
  channel: Channel;
  title: string;
  placeholder: string;
  profileId: string | null;
  prefs: PriorityPreference[];
  status?: ChannelEnforcement;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}

const TONE_COLOR: Record<string, string> = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  neutral: colors.neutral,
};

export const PriorityEditor = ({
  channel,
  title,
  placeholder,
  profileId,
  prefs,
  status,
  onReload,
  onError,
}: PriorityEditorProps) => {
  const [draft, setDraft] = useState('');

  const rows = prefs.filter((p) => p.channel === channel);
  const showBadge = rows.length > 0 || !CHANNEL_ENFORCEABLE[channel];
  const presentation = status && showBadge ? ENFORCEMENT_PRESENTATION[status.status] : null;

  const handleAdd = async () => {
    const subject = draft.trim();
    if (!subject || !profileId) return;
    try {
      await priorityRepository.addPreference({
        profileId,
        channel,
        subject,
        subjectKind: channel === 'whatsapp' && /group/i.test(subject) ? 'contactGroup' : 'contact',
      });
      setDraft('');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  return (
    <Card style={styles.section} elevated>
      <View style={styles.sectionHead}>
        <Text variant="h3">{title}</Text>
        {presentation ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: TONE_COLOR[presentation.tone] ?? colors.neutral },
            ]}
          >
            <Text variant="caption" weight="bold" style={styles.badgeText}>
              {presentation.label}
            </Text>
          </View>
        ) : null}
      </View>

      {CHANNEL_ENFORCEABLE[channel] ? null : (
        <Text variant="caption" color="textSecondary">
          Ally remembers this. Android gives no app a way to control WhatsApp notifications, so your
          phone will not change.
        </Text>
      )}

      {rows.length === 0 ? (
        <Text
          variant="caption"
          color="textTertiary"
          style={{ fontStyle: 'italic', marginTop: spacing.sm }}
        >
          No one added yet.
        </Text>
      ) : null}

      {rows.map((p) => (
        <View key={p.id} style={styles.item}>
          <View style={styles.itemMain}>
            <Button
              label={p.enabled ? 'ON' : 'off'}
              variant={p.enabled ? 'primary' : 'secondary'}
              style={styles.toggleBtn}
              onPress={async () => {
                await priorityRepository.setEnabled(p.id, !p.enabled);
                await onReload();
              }}
            />
            <Text
              variant="body"
              color={p.enabled ? 'textPrimary' : 'textSecondary'}
              style={{ flex: 1 }}
            >
              {p.subject}
            </Text>
            {p.subjectKind === 'contactGroup' ? (
              <View style={styles.tag}>
                <Text variant="caption">group</Text>
              </View>
            ) : null}
          </View>
          <Button
            label="Remove"
            variant="danger"
            style={styles.removeBtn}
            onPress={async () => {
              await priorityRepository.removePreference(p.id);
              await onReload();
            }}
          />
        </View>
      ))}

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={handleAdd}
        />
        <Button label="Add" variant="secondary" onPress={handleAdd} />
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgeText: {
    color: colors.textInverse,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 0,
  },
  removeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 0,
  },
  tag: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
  },
});
