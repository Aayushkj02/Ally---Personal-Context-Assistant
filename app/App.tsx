/**
 * OWNER: AAYUSH — tasks T1, T2, T3
 *
 * Phase 1 harness, NOT a product screen. Its jobs are to prove the dev build boots,
 * to make the active device backend visible (ADR-007 — a mock must never be mistaken
 * for real hardware), and to drive the capabilities under test on a real phone.
 *
 * Real screens are Phase 2 and are owned per docs/OWNERSHIP.md. This file gets
 * deleted, not grown.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ActionResult, CapabilityValue, DndMode } from './src/types';
import { STATUS_PRESENTATION } from './src/types';
import {
  device,
  getNativeDeviceInfo,
  runDndProbe,
  setPriorityCallers,
  analyseCallLog,
} from './src/native';

const DND_TESTS: { label: string; value: DndMode }[] = [
  { label: 'Priority', value: 'priority' },
  { label: 'Alarms only', value: 'alarms_only' },
  { label: 'Silence', value: 'total_silence' },
  { label: 'Off', value: 'off' },
];

const TONE_COLOR: Record<string, string> = {
  success: '#1E7F4B',
  warning: '#8A6100',
  danger: '#9B2C2C',
  info: '#1F5F9B',
  neutral: '#3A4250',
};

export default function App() {
  const info = getNativeDeviceInfo();
  const dnd = device.get('dnd');

  const [snapshot, setSnapshot] = useState<CapabilityValue | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [log, setLog] = useState<ActionResult[]>([]);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [bright, setBright] = useState<CapabilityValue | null>(null);
  // The value as it was BEFORE Ally touched anything. Restore must target this, not the
  // current reading — otherwise "restore" just re-applies whatever we last set.
  const [originalBright, setOriginalBright] = useState<CapabilityValue | null>(null);
  const brightness = device.get('brightness');

  const refresh = useCallback(async () => {
    setAvailable(await dnd.isAvailable());
    setSnapshot(await dnd.snapshot());
    const perms = await dnd.requiredPermissions();
    setGranted(perms[0]?.granted ?? null);
    const snap = await brightness.snapshot();
    setBright(snap);
    setOriginalBright((prev) => (prev === null ? snap : prev));
  }, [dnd, brightness]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (value: DndMode) => {
      const result = await dnd.execute(value);
      setLog((prev) => [result, ...prev].slice(0, 6));
      await refresh();
    },
    [dnd, refresh],
  );

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>Ally</Text>

      <View style={[styles.chip, device.backend === 'mock' ? styles.chipMock : styles.chipNative]}>
        <Text style={styles.chipText}>device backend: {device.backend}</Text>
      </View>

      {info ? (
        <Text style={styles.info}>
          {info.manufacturer} {info.model} · Android {info.release} · targetSdk {info.targetSdk}
        </Text>
      ) : (
        <Text style={styles.info}>MockDevice — nothing here touches the real phone.</Text>
      )}

      <View style={styles.divider} />

      <Text style={styles.section}>DND capability (T3)</Text>
      <Text style={styles.info}>
        available: {String(available)} · permission: {String(granted)} · current:{' '}
        <Text style={styles.strong}>{String(snapshot)}</Text>
      </Text>

      <View style={styles.row}>
        {DND_TESTS.map((t) => (
          <Pressable key={t.value} style={styles.btn} onPress={() => void run(t.value)}>
            <Text style={styles.btnText}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.btn, styles.btnWide]}
        onPress={() => void device.openSettingsFor('notification_policy')}
      >
        <Text style={styles.btnText}>Grant DND access</Text>
      </Pressable>

      <Pressable style={[styles.btn, styles.btnProbe]} onPress={() => setProbe(runDndProbe())}>
        <Text style={styles.btnText}>Run device probe</Text>
      </Pressable>

      <View style={styles.divider} />
      <Text style={styles.section}>Brightness (T4)</Text>
      <Text style={styles.info}>
        current: <Text style={styles.strong}>{String(bright)}%</Text>
      </Text>
      <View style={styles.row}>
        {[30, 70].map((p) => (
          <Pressable
            key={p}
            style={styles.btn}
            onPress={async () => {
              const r = await brightness.execute(p);
              setLog((prev) => [r, ...prev].slice(0, 6));
              await refresh();
            }}
          >
            <Text style={styles.btnText}>{p}%</Text>
          </Pressable>
        ))}
        <Pressable
          style={styles.btn}
          onPress={async () => {
            if (originalBright !== null) {
              const r = await brightness.restore(originalBright);
              setLog((prev) => [r, ...prev].slice(0, 6));
            }
            await refresh();
          }}
        >
          <Text style={styles.btnText}>Restore {String(originalBright)}%</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void device.openSettingsFor('write_settings')}>
          <Text style={styles.btnText}>Grant write</Text>
        </Pressable>
      </View>

      <View style={styles.divider} />
      <Text style={styles.section}>Call safety (T4)</Text>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => setProbe(setPriorityCallers(true, true))}>
          <Text style={styles.btnText}>Allow starred + repeat</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setProbe(analyseCallLog())}>
          <Text style={styles.btnText}>Check repeat callers</Text>
        </Pressable>
      </View>

      {probe ? (
        <View style={styles.probeBox}>
          <Text style={styles.probeVerdict}>{String(probe.verdict)}</Text>
          {Object.entries(probe)
            .filter(([k]) => k !== 'verdict')
            .map(([k, v]) => (
              <Text key={k} style={styles.probeRow}>
                {k}: <Text style={styles.strong}>{String(v)}</Text>
              </Text>
            ))}
        </View>
      ) : null}

      {log.map((r, i) => (
        <View key={i} style={styles.result}>
          <View
            style={[
              styles.pill,
              { backgroundColor: TONE_COLOR[STATUS_PRESENTATION[r.status].tone] },
            ]}
          >
            <Text style={styles.pillText}>{STATUS_PRESENTATION[r.status].label}</Text>
          </View>
          <Text style={styles.resultText}>
            {String(r.beforeValue)} → {String(r.afterValue)}
          </Text>
          <Text style={styles.resultMsg}>{r.message}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, paddingTop: 64, gap: 10, backgroundColor: '#0E1116', minHeight: '100%' },
  title: { fontSize: 34, fontWeight: '700', color: '#F5F7FA' },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipMock: { backgroundColor: '#3A2E12' },
  chipNative: { backgroundColor: '#12331F' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#F5F7FA' },
  info: { fontSize: 13, color: '#9AA4B2' },
  strong: { color: '#F5F7FA', fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#232A35', marginVertical: 10 },
  section: { fontSize: 17, fontWeight: '700', color: '#F5F7FA' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  btn: { backgroundColor: '#232A35', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnWide: { alignSelf: 'flex-start', marginTop: 4 },
  btnProbe: { backgroundColor: '#1F3A5F' },
  probeBox: { marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: '#161C26', gap: 3 },
  probeVerdict: { color: '#F5F7FA', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  probeRow: { color: '#9AA4B2', fontSize: 12 },
  btnText: { color: '#F5F7FA', fontSize: 13, fontWeight: '600' },
  result: { marginTop: 10, gap: 3 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  resultText: { color: '#C7CEDA', fontSize: 13 },
  resultMsg: { color: '#6B7688', fontSize: 12 },
});
