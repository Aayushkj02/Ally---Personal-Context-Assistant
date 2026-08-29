/**
 * OWNER: DHREY. FREEZE once Phase 1 closes — highest-conflict file in the UI tree.
 *
 * Status colours are NOT defined here. STATUS_PRESENTATION and ENFORCEMENT_PRESENTATION in
 * src/types own the vocabulary; this maps their `tone` to a colour so the two cannot drift
 * and tell the user different things.
 */

export const theme = {
  color: {
    bg: '#0E1116',
    surface: '#161C26',
    surfaceAlt: '#1E2532',
    border: '#232A35',
    text: '#F5F7FA',
    textDim: '#9AA4B2',
    textFaint: '#6B7688',
    accent: '#2E6BE6',
  },
  tone: {
    success: '#1E7F4B',
    warning: '#8A6100',
    danger: '#9B2C2C',
    info: '#1F5F9B',
    neutral: '#3A4250',
  } as Record<string, string>,
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 6, md: 10, pill: 999 },
  font: { sm: 12, base: 14, lg: 17, xl: 22, hero: 32 },
} as const;

const NEUTRAL = '#3A4250';

export function toneColor(tone: string): string {
  return theme.tone[tone] ?? NEUTRAL;
}
