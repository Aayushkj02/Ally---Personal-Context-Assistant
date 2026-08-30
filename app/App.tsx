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
  applyPriorityPreferences,
  analyseCallLog,
} from './src/native';
import {
  startContext,
  endContext as endContextLifecycle,
  createRepositorySnapshotStore,
  type LifecycleHooks,
} from './src/actions';
import { activateFromText } from './src/services/contextOrchestrator';
import { ensureSeeded, getActiveContext, markSessionActive, endSession } from './src/memory';

/**
 * A-V3: the coordinator's session hooks, wired to Dhrey's PUBLIC session API.
 *
 * This is the whole integration seam. `app/src/actions/` never imports `src/memory` — it reports
 * what happened to the phone and fires these, and the wiring lives here in the caller. When
 * Dhrey's orchestrator takes over from this harness it connects the same three callbacks and
 * nothing in the action engine changes.
 */
const sessionHooks: LifecycleHooks = {
  onActivated: (sessionId) => markSessionActive(sessionId).then(() => undefined),
  onEnded: (sessionId, state) => endSession(sessionId, { status: state }).then(() => undefined),
  onPartial: (sessionId) => endSession(sessionId, { status: 'PARTIAL' }).then(() => undefined),
};

/**
 * A-V1: the real Phase 2 sentence. Not a fixture — this string goes through Shlok's parser,
 * Dhrey's policy engine and buildActionPlan(), and whatever ActionPlan comes out is what the
 * executor receives. Nothing here constructs a plan by hand.
 */
const STUDY_COMMAND = "I'm going to study for two hours.";

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

/** Flattens the per-channel result into rows the existing debug renderer can show. */
function channelRows(r: {
  ok: boolean;
  channels: { channel: string; status: string; message: string }[];
}): Record<string, unknown> {
  return {
    verdict: r.ok ? 'calls + sms enforced' : 'not fully enforced',
    ...Object.fromEntries(r.channels.map((c) => [c.channel, `${c.status} — ${c.message}`])),
  };
}

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

  /**
   * A-V1: sentence -> Intent -> Policy -> ActionPlan -> ActionExecutor -> capability -> phone.
   *
   * The harness does exactly two things: ask Dhrey's orchestrator for a plan, and hand that
   * plan to the executor along with a device registry and a snapshot store. It never touches
   * an Android API itself and never builds a PlannedAction — that is the whole boundary
   * being proven here.
   */
  const runStudyPlan = useCallback(async () => {
    setProbe({ verdict: `parsing "${STUDY_COMMAND}" …` });

    try {
      await ensureSeeded();
      const outcome = await activateFromText(STUDY_COMMAND);

      if (outcome.kind !== 'activated') {
        setProbe({
          verdict: 'parser asked for clarification — nothing was applied',
          question: outcome.clarification.question,
        });
        return;
      }

      const phases: string[] = [];

      // One call. The execute -> summarise -> mark-active sequence lives in the coordinator now,
      // not here; the harness supplies a device, a store and the hooks (ADR-118).
      const { state, results, summary } = await startContext(outcome.plan, {
        registry: device,
        // Durable: Dhrey's device_snapshot table, reached through the SnapshotStore port.
        snapshots: createRepositorySnapshotStore(),
        hooks: sessionHooks,
        onProgress: (e) => {
          if (e.phase !== 'pending') phases.push(`${e.capability}:${e.phase}`);
        },
      });

      setLog(results.slice().reverse());
      setProbe({
        verdict: `${state} — ${summary.byStatus.applied}/${summary.total} applied`,
        sentence: STUDY_COMMAND,
        session: outcome.plan.sessionId,
        ...Object.fromEntries(
          results.map((r, i) => [`${i + 1}. ${r.capability}`, `${r.status} — ${r.message}`]),
        ),
        order: phases.join('  '),
      });
      await refresh();
    } catch (e) {
      setProbe({ verdict: 'run failed', error: e instanceof Error ? e.message : String(e) });
    }
  }, [refresh]);

  /**
   * A-V2: end the context and put the phone back.
   *
   * The session id is read from the DATABASE, not from React state, which is the whole point:
   * after the app has been force-stopped and reopened there is no React state left, and the
   * restore still has to work.
   */
  const onEndContext = useCallback(async () => {
    setProbe({ verdict: 'ending context…' });

    try {
      await ensureSeeded();
      const active = await getActiveContext();
      if (!active) {
        setProbe({ verdict: 'no active context to end' });
        return;
      }

      const snapshots = createRepositorySnapshotStore();
      const before = await snapshots.forSession(active.session.id);

      // One call. Restore, summarise, clear-only-if-clean and the session hook are all the
      // coordinator's job — the harness no longer decides when it is safe to drop rows.
      const { state, results, summary, cleared, retryable } = await endContextLifecycle(
        active.session.id,
        { registry: device, snapshots, hooks: sessionHooks },
      );

      setLog(results.slice().reverse());
      setProbe({
        verdict: `restore ${state} — ${summary.byStatus.restored}/${summary.total} restored`,
        session: active.session.id,
        snapshots: before.map((r) => `${r.capability}=${String(r.previousValue)}`).join('  '),
        retryable: String(retryable),
        ...Object.fromEntries(
          results.map((r, i) => [
            `${i + 1}. ${r.capability}`,
            `${r.status} — ${String(r.beforeValue)} → ${String(r.afterValue)}`,
          ]),
        ),
        cleared: String(cleared),
      });
      await refresh();
    } catch (e) {
      setProbe({ verdict: 'restore failed', error: e instanceof Error ? e.message : String(e) });
    }
  }, [refresh]);

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
      <Text style={styles.section}>Study vertical slice (A-V1)</Text>
      <Text style={styles.info}>
        &quot;{STUDY_COMMAND}&quot; → Intent → Policy → ActionPlan → startContext() → capability →
        phone. Expect ringer to come back not_supported until T5, so the plan is PARTIAL.
      </Text>
      <Pressable style={[styles.btn, styles.btnProbe]} onPress={() => void runStudyPlan()}>
        <Text style={styles.btnText}>Run the Study sentence</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.btnProbe]} onPress={() => void onEndContext()}>
        <Text style={styles.btnText}>End context (restore)</Text>
      </Pressable>
      <Text style={styles.info}>
        End context reads the session from the database, so it still works after the app has been
        force-stopped and reopened. That is the A-V2 proof.
      </Text>

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
        <Pressable
          style={styles.btn}
          onPress={() => {
            // Ask for all three. Calls and SMS reach Android; WhatsApp never does and comes
            // back preference_only, which is the entire point of the vocabulary.
            const r = applyPriorityPreferences({ calls: true, sms: true, whatsapp: true });
            setProbe(r ? channelRows(r) : null);
          }}
        >
          <Text style={styles.btnText}>Apply priority (calls+sms+wa)</Text>
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
