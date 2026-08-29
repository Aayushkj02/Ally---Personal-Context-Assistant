import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radius, spacing } from '../theme';

export interface TimerProps {
  endsAt: number;
  onExpire?: () => void;
}

export const Timer = ({ endsAt, onExpire }: TimerProps) => {
  const [timeLeft, setTimeLeft] = useState(Math.max(0, endsAt - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, endsAt - Date.now());
      setTimeLeft(remaining);
      
      if (remaining <= 0) {
        clearInterval(interval);
        if (onExpire) onExpire();
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [endsAt, onExpire]);

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  return (
    <View style={styles.container}>
      <Text preset="bodyMedium" color="primary">
        {`${minutes}:${seconds.toString().padStart(2, '0')}`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primaryLight + '30',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  }
});
