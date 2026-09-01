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
  /**
   * True once the device has actually been asked (Apply pressed). Enforceable channels have no
   * verdict before that, and showing one would be a claim about Android that nobody has tested.
   */
  applied?: boolean;
  /**
   * Opens the system contact picker. Injected, never imported — the native layer stays Aayush's
   * boundary (see PriorityScreenProps). Absent on the mock backend, where the free-text row is
   * kept so the screen still works.
   */
  onPickContact?: () => Promise<{
    ok: boolean;
    displayName?: string;
    starred?: boolean;
    reason?: string;
  }>;
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
  onPickContact,
  applied = false,
}: PriorityEditorProps) => {
  const [draft, setDraft] = useState('');
  /**
   * The one-line verdict on the contact just added. Display only, and deliberately not persisted:
   * whether someone is starred is a live property of the phone's Contacts, so a stored copy would
   * go stale and start making a promise Android would not keep (ADR-111).
   */
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const rows = prefs.filter((p) => p.channel === channel);

  /**
   * Calls and SMS have no honest status until Apply has run. WhatsApp does: `preference_only` is a
   * fact about Android, true before anyone presses anything, so its badge stays.
   */
  const awaitingApply = CHANNEL_ENFORCEABLE[channel] && !applied;
  const showBadge = (rows.length > 0 || !CHANNEL_ENFORCEABLE[channel]) && !awaitingApply;
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

  /**
   * Add a contact by picking them, for the channels Android can actually enforce.
   *
   * This also fixes the reason "Add" appeared to do nothing: the free-text row opens the soft
   * keyboard, which covers the Add button, so a tap where the button is drawn lands on a key
   * instead. Measured on SM-S928B — the row only ever saved via the keyboard's own Enter
   * (`onSubmitEditing`). Picking involves no keyboard at all.
   */
  const handlePick = async () => {
    if (!profileId || !onPickContact) return;
    setNotice(null);

    const picked = await onPickContact();
    if (!picked.ok || !picked.displayName) {
      // Cancelling is not a failure and must stay silent. Anything else is worth a word.
      if (picked.reason && picked.reason !== 'cancelled') {
        onError('Could not read that contact. Nothing was added.');
      }
      return;
    }

    try {
      await priorityRepository.addPreference({
        profileId,
        channel,
        // The name exactly as the phone's own Contacts renders it. Never a default, never a guess.
        subject: picked.displayName,
        subjectKind: 'contact',
      });
      setNotice(
        picked.starred
          ? {
              ok: true,
              text: `${picked.displayName} is starred — Android will let their calls through.`,
            }
          : {
              ok: false,
              text: `${picked.displayName} is not starred. Android only lets STARRED contacts through, so they will still be silenced until you star them in Contacts.`,
            },
      );
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

      {/*
        Two different ways in, because the two cases are genuinely different.

        CALLS AND SMS pick from the phone's own contacts. Android enforces these by STARRED
        contact, so the name has to match a real person for the preference to mean anything — and
        picking is what lets Ally read `starred` back and say whether the promise will be kept.
        It also sidesteps the keyboard covering the Add button.

        WHATSAPP STAYS FREE TEXT. WhatsApp groups do not exist in ContactsContract — they live
        inside WhatsApp — so a picker literally cannot offer them, and swapping this row for one
        would quietly remove the ability to name a group.
      */}
      {CHANNEL_ENFORCEABLE[channel] && onPickContact ? (
        <View style={styles.addRow}>
          <Button label="Add from contacts" variant="secondary" onPress={handlePick} />
        </View>
      ) : (
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
      )}

      {/* Whether Android will actually honour what was just added. Words, not just a colour. */}
      {notice ? (
        <Text
          variant="caption"
          color={notice.ok ? 'success' : 'warning'}
          style={{ marginTop: spacing.sm }}
        >
          {notice.ok ? '✓ ' : '⚠ '}
          {notice.text}
        </Text>
      ) : null}
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
