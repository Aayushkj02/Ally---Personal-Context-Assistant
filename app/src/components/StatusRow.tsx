import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radius, spacing } from '../theme';

export interface StatusRowProps {
  label: string;
  status: 'pending' | 'success' | 'failed' | 'idle';
  message?: string;
  style?: any;
}

export const StatusRow = ({ label, status, message, style }: StatusRowProps) => {
  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return colors.primary;
      case 'failed':
        return colors.danger;
      case 'pending':
        return colors.textSecondary;
      default:
        return colors.textTertiary;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'success':
        return '✓ Success';
      case 'failed':
        return '✗ Failed';
      case 'pending':
        return '⋯ Pending';
      default:
        return 'Idle';
    }
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.row}>
        <Text variant="body" weight="medium">
          {label}
        </Text>
        <View style={[styles.badge, { backgroundColor: `${getStatusColor()}15` }]}>
          <Text variant="caption" weight="bold" style={{ color: getStatusColor() }}>
            {getStatusText()}
          </Text>
        </View>
      </View>
      {message ? (
        <Text variant="caption" color="textSecondary" style={styles.message}>
          {message}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  message: {
    marginTop: spacing.xs,
  },
});
