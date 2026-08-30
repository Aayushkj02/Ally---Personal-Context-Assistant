import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { colors, spacing, radius } from '../theme';
import type { PermissionRequirement } from '../types/capability';

export interface PermissionRowProps {
  permission: PermissionRequirement;
  onRequest: (key: PermissionRequirement['key']) => void;
}

export const PermissionRow = ({ permission, onRequest }: PermissionRowProps) => {
  return (
    <View style={styles.container}>
      <View style={styles.textContainer}>
        <Text preset="bodyMedium">{permission.label}</Text>
        <Text preset="caption" color="textSecondary" style={styles.rationale}>
          {permission.rationale}
        </Text>
      </View>
      <View style={styles.actionContainer}>
        {permission.granted ? (
          <Text preset="micro" color="success" accessibilityLabel={`${permission.label}: granted`}>
            Granted
          </Text>
        ) : (
          <Button
            label="Grant"
            variant="secondary"
            accessibilityLabel={`Grant ${permission.label}`}
            onPress={() => onRequest(permission.key)}
            style={styles.button}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  textContainer: {
    flex: 1,
    paddingRight: spacing.md,
  },
  rationale: {
    marginTop: spacing.xs,
  },
  actionContainer: {
    minWidth: 70,
    alignItems: 'center',
  },
  button: {
    minHeight: 36,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
});
