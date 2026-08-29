/**
 * OWNER: AAYUSH — tasks T1, T2
 *
 * Minimal root. Its only job in Phase 1 is to prove the dev build boots and to make
 * the active device backend VISIBLE.
 *
 * That backend line is not decoration: ADR-007 requires that a mock is never mistaken
 * for real hardware. It reads "mock" in Expo Go or on any build without the Kotlin
 * module, and "native" once the development build is installed.
 *
 * The device info below is what T3 needs to choose its DND rung — note that the app's
 * own targetSdk, not the device OS version, is what decides whether legacy DND control
 * is permitted (ADR-102).
 *
 * Real screens are Phase 2 and are owned per docs/OWNERSHIP.md. Do not grow this file.
 */

import { StyleSheet, Text, View } from 'react-native';

import { device, getNativeDeviceInfo } from './src/native';

export default function App() {
  const isMock = device.backend === 'mock';
  const info = getNativeDeviceInfo();

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Ally</Text>
      <Text style={styles.tagline}>
        Don&apos;t configure your phone. Tell it what you&apos;re doing.
      </Text>

      <View style={[styles.chip, isMock ? styles.chipMock : styles.chipNative]}>
        <Text style={styles.chipText}>device backend: {device.backend}</Text>
      </View>

      {info ? (
        <View style={styles.infoBox}>
          <Text style={styles.info}>
            {info.manufacturer} {info.model}
          </Text>
          <Text style={styles.info}>
            Android {info.release} · device API {info.sdkInt} · app targetSdk {info.targetSdk}
          </Text>
          <Text style={styles.infoDim}>
            {info.targetSdk >= 35
              ? 'targetSdk >= 35 — DND needs AutomaticZenRule (ADR-102 rung 1)'
              : 'targetSdk <= 34 — legacy setInterruptionFilter permitted (ADR-102 rung 2)'}
          </Text>
        </View>
      ) : (
        <Text style={styles.note}>
          No native module — running against MockDevice. Nothing here touches the real phone.
        </Text>
      )}
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
  infoBox: { marginTop: 12, alignItems: 'center', gap: 4 },
  info: { fontSize: 13, color: '#9AA4B2', textAlign: 'center' },
  infoDim: { fontSize: 12, color: '#6B7688', textAlign: 'center', marginTop: 6 },
  note: { fontSize: 13, color: '#6B7688', textAlign: 'center', marginTop: 8 },
});
