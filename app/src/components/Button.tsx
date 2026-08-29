import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, spacing, radius } from '../theme';

export interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: any;
  [key: string]: any;
}

export const Button = ({ label, variant = 'primary', style, ...props }: ButtonProps) => {
  const getBackgroundColor = () => {
    switch (variant) {
      case 'secondary': return colors.surfaceElevated;
      case 'danger': return colors.danger;
      default: return colors.primary;
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
        style
      ]} 
      activeOpacity={0.8}
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
  }
});
