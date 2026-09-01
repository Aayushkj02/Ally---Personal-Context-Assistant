import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radius, spacing } from '../theme';

export interface ModeIndicatorProps {
  mode: string;
  isActive?: boolean;
  style?: any;
}

export const ModeIndicator = ({ mode, isActive = true, style }: ModeIndicatorProps) => {
  const normalizedMode = mode.toLowerCase();

  const getModeColor = () => {
    if (!isActive) return colors.textTertiary;
    switch (normalizedMode) {
      case 'study':
        return colors.primary;
      case 'sleep':
        return '#8B5CF6'; // Purple
      case 'office':
        return '#10B981'; // Green
      default:
        return colors.textPrimary;
    }
  };

  const getModeIcon = () => {
    switch (normalizedMode) {
      case 'study':
        return '📚';
      case 'sleep':
        return '🌙';
      case 'office':
        return '💼';
      default:
        return '⚙️';
    }
  };

  const color = getModeColor();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isActive ? `${color}15` : colors.surfaceElevated },
        style,
      ]}
    >
      <Text style={styles.icon}>{getModeIcon()}</Text>
      <Text
        variant="caption"
        weight="bold"
        style={{ color: isActive ? color : colors.textSecondary }}
      >
        {mode.charAt(0).toUpperCase() + mode.slice(1)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  icon: {
    marginRight: spacing.xs,
    fontSize: 12,
  },
});
