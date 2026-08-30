import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { STATUS_PRESENTATION } from '../types/policy';
import type { ActionStatus } from '../types/policy';
import { colors, radius, spacing } from '../theme';

export interface StatusChipProps {
  status: ActionStatus;
}

export const StatusChip = ({ status }: StatusChipProps) => {
  const presentation = STATUS_PRESENTATION[status];

  // Convert tone to theme color safely
  const toneColor = colors[presentation.tone as keyof typeof colors] || colors.neutral;

  return (
    <View
      style={[styles.chip, { backgroundColor: toneColor + '20' }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Status: ${presentation.label}`}
    >
      <Text preset="micro" style={{ color: toneColor }}>
        {presentation.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
