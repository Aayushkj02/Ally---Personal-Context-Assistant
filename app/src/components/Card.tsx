import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../theme';

export interface CardProps {
  elevated?: boolean;
  variant?: 'default' | 'highlight' | 'danger';
  style?: any;
  children?: any;
  [key: string]: any;
}

export const Card = ({
  elevated = false,
  variant = 'default',
  style,
  children,
  ...props
}: CardProps) => {
  return (
    <View
      style={[
        styles.card,
        elevated && styles.elevated,
        variant === 'highlight' && styles.highlight,
        variant === 'danger' && styles.danger,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  elevated: {
    backgroundColor: colors.surfaceElevated,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  highlight: {
    backgroundColor: `${colors.primary}10`, // 10% opacity
    borderColor: colors.primary,
  },
  danger: {
    backgroundColor: `${colors.danger}10`, // 10% opacity
    borderColor: colors.danger,
  },
});
