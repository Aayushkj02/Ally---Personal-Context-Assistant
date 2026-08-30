import React from 'react';
import { Text as RNText, StyleSheet } from 'react-native';
import { typography, colors } from '../theme';

export interface TextProps {
  preset?: keyof typeof typography.presets;
  color?: keyof typeof colors;
  align?: 'left' | 'center' | 'right';
  children?: any;
  style?: any;
  [key: string]: any;
}

export const Text = ({
  preset = 'body',
  color = 'textPrimary',
  align = 'left',
  style,
  children,
  ...props
}: TextProps) => {
  return (
    <RNText
      style={[
        typography.presets[preset as keyof typeof typography.presets],
        { color: colors[color as keyof typeof colors] as string, textAlign: align },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
};
