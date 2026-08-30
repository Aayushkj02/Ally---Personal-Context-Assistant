import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, spacing, radius } from '../theme';

export interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  /** Defaults to `label`. Override when the label alone lacks context. */
  accessibilityLabel?: string;
  style?: any;
  [key: string]: any;
}

export const Button = ({
  label,
  variant = 'primary',
  disabled = false,
  accessibilityLabel,
  style,
  ...props
}: ButtonProps) => {
  const getBackgroundColor = () => {
    switch (variant) {
      case 'secondary':
        return colors.surfaceElevated;
      case 'danger':
        return colors.danger;
      default:
        return colors.primary;
    }
  };

  const getTextColor = () => {
    return variant === 'secondary' ? 'textPrimary' : 'textInverse';
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: getBackgroundColor() as string },
        disabled && styles.disabled,
        style,
      ]}
      activeOpacity={0.8}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      {...props}
    >
      <Text preset="bodyMedium" color={getTextColor()} align="center">
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  disabled: {
    opacity: 0.5,
  },
});
