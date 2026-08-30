export const typography = {
  // Weights
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semiBold: '600' as const,
    bold: '700' as const,
  },

  // Sizes
  size: {
    xs: 12,
    sm: 14,
    md: 16, // Body default
    lg: 18,
    xl: 24, // Headers
    xxl: 32,
  },

  // Common combinations for consistency
  presets: {
    h1: { fontSize: 32, fontWeight: '700' as const, lineHeight: 40 },
    h2: { fontSize: 24, fontWeight: '600' as const, lineHeight: 32 },
    h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 28 },
    body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
    bodyMedium: { fontSize: 16, fontWeight: '500' as const, lineHeight: 24 },
    caption: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
    micro: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
  }
};
