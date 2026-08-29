/**
 * OWNER: AAYUSH — task T1
 *
 * Minimal root. Its only job in Phase 1 is to prove the dev build boots and to make
 * the active device backend VISIBLE.
 *
 * That backend line is not decoration: ADR-007 requires that a mock is never mistaken
 * for real hardware. Until the Kotlin module lands (T2) this reads "mock", and the
 * moment it says "native" we know T2 actually wired up.
 *
 * Real screens are Phase 2 and are owned per docs/OWNERSHIP.md. Do not grow this file.
 */

import { StyleSheet, Text, View } from 'react-native';

import { device } from './src/native';

export default function App() {
  const isMock = device.backend === 'mock';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Ally</Text>
      <Text style={styles.tagline}>
        Don&apos;t configure your phone. Tell it what you&apos;re doing.
      </Text>

      <View style={[styles.chip, isMock ? styles.chipMock : styles.chipNative]}>
        <Text style={styles.chipText}>device backend: {device.backend}</Text>
      </View>

      <Text style={styles.note}>
        {isMock
          ? 'No native module yet — running against MockDevice. Nothing here touches the real phone.'
          : 'Native module active. Device actions are real.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#0E1116',
  },
  title: { fontSize: 40, fontWeight: '700', color: '#F5F7FA' },
  tagline: { fontSize: 15, color: '#9AA4B2', textAlign: 'center' },
  chip: { marginTop: 16, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  chipMock: { backgroundColor: '#3A2E12' },
  chipNative: { backgroundColor: '#12331F' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#F5F7FA' },
  note: { fontSize: 13, color: '#6B7688', textAlign: 'center', marginTop: 8 },
});
