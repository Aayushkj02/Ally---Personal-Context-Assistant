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
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ActionResult, CapabilityValue, Channel, DndMode } from './src/types';
import { STATUS_PRESENTATION } from './src/types';
import {
  device,
  borrowedPolicy,
  withAlarmContext,
  dismissAllyAlarm,
  showClockAlarms,
  alarmDebugState,
  getNativeDeviceInfo,
  runDndProbe,
  pickContact,
  allyNativeSpike,
  applyPriorityPreferences,
  analyseCallLog,
  // A7 — Study Mode Focus Guard. A redirect, not a block: see src/native/FocusGuard.ts.
  syncFocusGuard,
  focusGuardStatus,
  focusGuardPresentation,
  openFocusGuardSettings,
} from './src/native';
import { PriorityScreen } from './src/screens';
import { evaluateEmergency, type ContextState, type EmergencyStatus } from './src/actions';
import type { ChannelEnforcement, ContextSession } from './src/types';
import {
  startContext,
  endContext as endContextLifecycle,
  createRepositorySnapshotStore,
  mirrorContextStart,
  mirrorContextEnd,
  heldForSession,
  type HeldOutcome,
  type ExplainedResult,
  type LifecycleHooks,
} from './src/actions';
import { activateFromText } from './src/services/contextOrchestrator';
// A6.5: Dhrey's session-sync client (D-V10), used unmodified. It had no callers until Phase 6 —
// the transport was built, nothing drove it. SOFTWARE ONLY: the physical Office Kit is deferred
// until the team qualifies for the Pune round.
import { sessionSync } from './src/services/sessionSync';
import { useRoute } from './src/navigation';
import { ActiveContextScreen } from './src/screens';
import HomeScreen from './src/screens/Home';
import { applyPriorityForActivity } from './src/services/priorityIntegration';
import {
  ensureSeeded,
  getActiveContext,
  markSessionActive,
  endSession,
  profileRepository,
} from './src/memory';

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

/**
 * The value the harness "teaches" Ally for Study (Phase 4, A4.1).
 *
 * Deliberately NOT 40. study.json's default IS 40, so teaching 40 would look identical on the
 * phone whether the preference reached the device or not, and would prove nothing.
 */
const TAUGHT_BRIGHTNESS = 25;
const TAUGHT_SENTENCE = `Remember that I prefer ${TAUGHT_BRIGHTNESS}% brightness during study`;

/** A5.3 — the Phase 5 acceptance sentence, verbatim. */
const SLEEP_COMMAND = "I'm going to sleep. Wake me at 7 AM on weekdays.";
/** The one-shot half of A5.6: same time, no recurrence, so the two must not look alike. */
const SLEEP_ONCE_COMMAND = 'Wake me at 7 AM.';

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

/**
 * A-V9. The app shell: a route, a live view of whatever context is running, and the harness.
 *
 * The active context is read from the DATABASE on every visit, never from React state, so the
 * screen is correct after a process death — which is the same reason endContext() takes only a
 * sessionId. Execution results are held here only for as long as they are being displayed;
 * the durable record is Dhrey's session row and the snapshots.
 */
export default function App() {
  const { route, navigate, home } = useRoute();

  const [session, setSession] = useState<ContextSession | null>(null);
  const [label, setLabel] = useState('Context');
  const [state, setState] = useState<ContextState>('READY');
  const [results, setResults] = useState<ActionResult[]>([]);
  /**
   * Why each of those changes was made, positionally aligned with `results` (A4.2).
   *
   * Cleared whenever the results come from a RESTORE rather than a plan. A restore is driven by
   * snapshots, so there is no reason to give — and leaving the apply's reasons in place would
   * caption "Restored" rows with the explanation for why they were changed in the first place.
   */
  const [reasons, setReasons] = useState<readonly (string | null)[]>([]);
  /**
   * A6.1 — what Ally is holding, from the persisted snapshots.
   *
   * Loaded on every context refresh so that a session recovered after a process death can say what
   * it is holding instead of "Nothing yet". `results` above is deliberately still in-memory: it is
   * the richer per-action record and it is correct to lose it, but losing it must not read as
   * "your phone is untouched".
   */
  const [held, setHeld] = useState<HeldOutcome | null>(null);
  const [priority, setPriority] = useState<ChannelEnforcement[] | null>(null);
  const [emergency, setEmergency] = useState<EmergencyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  /**
   * A7 — the Focus Guard status, re-read on every context refresh.
   *
   * Held as the RAW native status rather than the presentation object so that the mapping stays a
   * pure function of state, computed at render. Null means the mock backend, which the
   * presentation layer has its own honest sentence for.
   */
  const [focusGuard, setFocusGuard] = useState(() => focusGuardStatus());
  const deviceInfo = getNativeDeviceInfo();

  /** Re-reads whatever context is genuinely running. The DB is the source of truth. */
  const refreshContext = useCallback(async () => {
    try {
      await ensureSeeded();
      const active = await getActiveContext();
      setSession(active?.session ?? null);
      if (active) {
        setLabel(active.session.profileId.replace(/^profile_/, '') || 'Context');
        setState(active.session.status === 'ACTIVE' ? 'ACTIVE' : 'READY');
        setHeld(await heldForSession(active.session.id, createRepositorySnapshotStore()));
      } else {
        setHeld(null);
      }

      /*
       * A7.7 / A7.8 — Focus Guard follows the SESSION, and it is reconciled here rather than at
       * the two places a session starts and ends.
       *
       * This function already re-reads the database on every visit precisely because React state
       * is not trustworthy after a process death; the guard has exactly the same problem, so it
       * gets exactly the same answer. Reconciling from `active` means start, end, expiry, a
       * recovered session, and a sleep session that must NOT restrict anything are all one branch
       * instead of five call sites that could each be forgotten.
       *
       * The native side additionally expires itself at the session's end time, which covers the
       * one case this cannot: Ally killed and never reopened.
       */
      setFocusGuard(
        syncFocusGuard({
          isStudy: active?.session.profileId === 'profile_study',
          endsAt: active?.session.endsAt ?? null,
        }),
      );
    } catch {
      setSession(null);
      setHeld(null);
    }
  }, []);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  /**
   * A7.10 — re-read Focus Guard whenever Ally comes back to the front.
   *
   * Accessibility access is granted in ANDROID's settings, in another app, with Ally backgrounded.
   * Nothing inside Ally is notified when it happens, so returning to the front is the only
   * reliable moment to ask again. Without this the card still reads "not set up" after the user
   * has just set it up, which reads as the feature being broken.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setFocusGuard(focusGuardStatus());
    });
    return () => sub.remove();
  }, []);

  /**
   * A6.3 — the product path, and the only one Home uses.
   *
   * Sentence → Dhrey's orchestrator → ActionPlan → ContextCoordinator → ActionExecutor → device.
   * There is deliberately no branch here that reaches an Android API directly: Home cannot start
   * a context except through the executor, which is the whole point of the task.
   *
   * `DeviceHarness` keeps its own richer version behind the `devtools` route because it renders
   * raw probe internals a product screen has no business showing. Both call the same
   * activateFromText → startContext path, so neither can drift into a second execution route.
   */
  const runSentence = useCallback(
    async (sentence: string) => {
      setBusy(true);
      try {
        await ensureSeeded();
        const outcome = await activateFromText(sentence);
        if (outcome.kind !== 'activated') return;

        // A5.3 — the recurrence the user actually said, bound before the device is handed over.
        const schedule = outcome.intent.schedule;
        const registry =
          schedule && schedule.kind !== 'none'
            ? withAlarmContext(device, {
                recurrence: schedule.kind === 'weekdays' ? 'weekdays' : 'once',
                sessionId: outcome.plan.sessionId,
              })
            : device;

        const started = await startContext(outcome.plan, {
          registry,
          snapshots: createRepositorySnapshotStore(),
          hooks: sessionHooks,
          applyPriority: async () => {
            const o = await applyPriorityForActivity(outcome.intent.activity);
            return o?.enforcement ?? null;
          },
        });

        setState(started.state);
        setResults(started.results);
        setReasons(started.explained.map((e) => e.reason));
        setPriority(started.priority);
        setEmergency(null);
        setEndError(null);

        // A6.5 — software/session-sync mirror. Not the physical Office Kit.
        void mirrorContextStart(outcome.plan, started, sessionSync, {
          profileId: outcome.profile.id,
          durationMinutes: outcome.intent.durationMinutes,
        });

        await refreshContext();
        navigate('activeContext');
      } finally {
        setBusy(false);
      }
    },
    [refreshContext, navigate],
  );

  if (route === 'priority') {
    return (
      <View style={{ flex: 1 }}>
        <PriorityScreen
          onPickContact={pickContact}
          onApply={(channels: Record<Channel, boolean>) => {
            const r = applyPriorityPreferences({
              calls: channels.calls,
              sms: channels.sms,
              whatsapp: channels.whatsapp,
            });
            return r?.channels ?? null;
          }}
        />
        <Pressable style={styles.backBtn} onPress={home}>
          <Text style={styles.btnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (route === 'activeContext') {
    return (
      <ActiveContextScreen
        session={session}
        label={label}
        state={state}
        results={results}
        reasons={reasons}
        endError={endError}
        held={held}
        priority={priority}
        emergency={emergency}
        busy={busy}
        onCheckEmergency={() =>
          setEmergency(
            evaluateEmergency({ analyse: analyseCallLog, sessionId: session?.id ?? null }),
          )
        }
        onEnd={async () => {
          if (!session) return;
          setBusy(true);
          try {
            const snapshots = createRepositorySnapshotStore();
            const r = await endContextLifecycle(session.id, {
              registry: device,
              snapshots,
              hooks: sessionHooks,
              // Priority rewrote the user's notification policy from outside the plan, so ending
              // has to be able to give it back even with no `dnd` row to carry it (ADR-125).
              policy: borrowedPolicy,
            });

            // A6.5: software/session-sync mirror of the ending. Not Office Kit hardware.
            void mirrorContextEnd(r, sessionSync, { profileId: session.profileId });
            setResults(r.results);
            setReasons([]);
            setState(r.state);
            setPriority(null);
            setEmergency(null);
            // A restore that could not even be attempted has no rows to explain it, so the
            // message is the only thing the user has to go on. Seen on device: expo-sqlite
            // rejected and the phone stayed dimmed with nothing but a red toast.
            setEndError(r.error);
            await refreshContext();
            // A clean restore means no context is running any more; leave the screen so the
            // user is not looking at something that no longer exists.
            if (r.state === 'IDLE') home();
          } finally {
            setBusy(false);
          }
        }}
        onBack={home}
      />
    );
  }

  if (route === 'devtools') {
    return (
      <DeviceHarness
        onOpenPriority={() => navigate('priority')}
        onOpenActive={() => {
          void refreshContext();
          navigate('activeContext');
        }}
        onStarted={(next) => {
          setState(next.state);
          setResults(next.results);
          setReasons(next.explained.map((e) => e.reason));
          setPriority(next.priority);
          setEmergency(null);
          void refreshContext();
        }}
        onBack={home}
      />
    );
  }

  // A6.6 — Home is the way in. The Phase 2 harness is demoted to `devtools`, not deleted: its
  // probes are still the fastest way to diagnose a phone, and it is no longer what anyone sees
  // first.
  return (
    <HomeScreen
      session={session}
      label={label}
      state={state}
      busy={busy}
      backend={device.backend}
      deviceLine={
        deviceInfo
          ? `${deviceInfo.manufacturer} ${deviceInfo.model} · Android ${deviceInfo.release} · targetSdk ${deviceInfo.targetSdk}`
          : 'MockDevice — nothing here touches a real phone'
      }
      onStartStudy={() => void runSentence(STUDY_COMMAND)}
      onStartSleep={() => void runSentence(SLEEP_COMMAND)}
      onOpenActive={() => {
        void refreshContext();
        navigate('activeContext');
      }}
      onOpenPriority={() => navigate('priority')}
      onOpenDevTools={() => navigate('devtools')}
      focusGuard={focusGuardPresentation(focusGuard)}
      onOpenFocusGuardSettings={() => {
        // Re-reading is handled by the AppState listener above: the answer changes while Ally is
        // in the background, so asking again on this line would only re-read the stale one.
        openFocusGuardSettings();
      }}
    />
  );
}

function DeviceHarness({
  onOpenPriority,
  onOpenActive,
  onBack,
  onStarted,
}: {
  onOpenPriority: () => void;
  onOpenActive: () => void;
  /** A6.6 — back to Home, now that the harness is a route rather than the entry point. */
  onBack: () => void;
  onStarted: (r: {
    state: ContextState;
    results: ActionResult[];
    explained: ExplainedResult[];
    priority: ChannelEnforcement[] | null;
  }) => void;
}) {
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
  /** What Ally currently remembers for Study, read back from Dhrey's table. */
  const [taught, setTaught] = useState('nothing');

  /**
   * Reads the stored preferences back so the harness reports the DATABASE, not what the last
   * button press intended. Same rule as everything else here — never show a value we did not read.
   */
  const refreshTaught = useCallback(async () => {
    try {
      await ensureSeeded();
      const rows = await profileRepository.getPreferencesByProfile('profile_study');
      setTaught(
        rows.length === 0
          ? 'nothing'
          : rows.map((r) => `${r.capability}=${String(r.value)} (${r.source})`).join(', '),
      );
    } catch {
      setTaught('could not read');
    }
  }, []);

  /**
   * Writes the preference a teaching command will eventually write.
   *
   * Dhrey's public repository, unmodified — this is not a second store and it decides no policy.
   * It exists because nothing yet turns the sentence into a row, and the Phase 4 gate has to be
   * demonstrable on the phone rather than only in jest.
   */
  const teachBrightness = useCallback(async () => {
    await ensureSeeded();
    await profileRepository.createPreference({
      id: `taught_brightness_${Date.now().toString(36)}`,
      profileId: 'profile_study',
      capability: 'brightness',
      value: TAUGHT_BRIGHTNESS,
      source: 'user',
      // The provenance that makes this a memory rather than a setting.
      sourceCommand: TAUGHT_SENTENCE,
      createdAt: Date.now(),
    });
    await refreshTaught();
  }, [refreshTaught]);

  const forgetTaught = useCallback(async () => {
    const rows = await profileRepository.getPreferencesByProfile('profile_study');
    for (const row of rows) await profileRepository.deletePreference(row.id);
    await refreshTaught();
  }, [refreshTaught]);

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
    void refreshTaught();
  }, [refresh, refreshTaught]);

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
  const runCommand = useCallback(
    async (sentence: string) => {
      setProbe({ verdict: `parsing "${sentence}" …` });

      try {
        await ensureSeeded();
        const outcome = await activateFromText(sentence);

        if (outcome.kind === 'clarification') {
          setProbe({
            verdict: 'parser asked for clarification — nothing was applied',
            question: outcome.clarification.question,
          });
          return;
        }

        if (outcome.kind === 'taught') {
          setProbe({
            verdict: 'preference saved — nothing was applied',
            sentence,
          });
          return;
        }

        if (outcome.kind === 'memory-query') {
          setProbe({
            verdict: `memory queried — ${outcome.memory.capabilities.length} capabilities, ${outcome.memory.priorities.length} priorities`,
            sentence,
          });
          return;
        }

        const phases: string[] = [];

        // One call. The execute -> summarise -> mark-active sequence lives in the coordinator now,
        // not here; the harness supplies a device, a store and the hooks (ADR-118).
        // A5.3: the shell binds THIS command's recurrence to the alarm capability before handing
        // the device over. It cannot ride in the ActionPlan — PlannedAction.value is a string, so a
        // one-shot and a weekday alarm arrive identical (ADR-127). `intent.schedule.kind` is the
        // user's own words, resolved upstream; nothing here infers it.
        const schedule = outcome.intent.schedule;
        const registry =
          schedule && schedule.kind !== 'none'
            ? withAlarmContext(device, {
                recurrence: schedule.kind === 'weekdays' ? 'weekdays' : 'once',
                sessionId: outcome.plan.sessionId,
              })
            : device;

        const started = await startContext(outcome.plan, {
          registry,
          // Durable: Dhrey's device_snapshot table, reached through the SnapshotStore port.
          snapshots: createRepositorySnapshotStore(),
          hooks: sessionHooks,
          // A-V7: who may still reach the user while Study runs. Resolution and the device call
          // are both Dhrey's applyPriorityForActivity(); the coordinator only decides when.
          applyPriority: async () => {
            const o = await applyPriorityForActivity(outcome.intent.activity);
            return o?.enforcement ?? null;
          },
          onProgress: (e) => {
            if (e.phase !== 'pending') phases.push(`${e.capability}:${e.phase}`);
          },
        });

        // A-V9: hand the outcome to the shell so the Active Context screen shows the real thing
        // rather than recomputing it. The shell holds it for display only.
        const { state, results, summary, priority, explained } = started;

        onStarted({ state, results, explained, priority });

        // A6.5: push what just happened to the laptop. SOFTWARE / SESSION-SYNC ONLY — this proves
        // nothing about the physical Office Kit, which the team does not have. Fire-and-forget on
        // top of a transport that already swallows, so a dead bridge cannot touch the phone.
        void mirrorContextStart(outcome.plan, started, sessionSync, {
          profileId: outcome.profile.id,
          durationMinutes: outcome.intent.durationMinutes,
        });

        setLog(results.slice().reverse());
        setProbe({
          verdict: `${state} — ${summary.byStatus.applied}/${summary.total} applied`,
          sentence,
          schedule: schedule ? `${schedule.kind} ${schedule.time ?? ''}`.trim() : 'none',
          session: outcome.plan.sessionId,
          ...Object.fromEntries(
            results.map((r, i) => [`${i + 1}. ${r.capability}`, `${r.status} — ${r.message}`]),
          ),
          order: phases.join('  '),
          ...Object.fromEntries(
            (priority ?? []).map((c) => [`priority ${c.channel}`, `${c.status} — ${c.message}`]),
          ),
        });
        await refresh();
      } catch (e) {
        setProbe({ verdict: 'run failed', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [refresh, onStarted],
  );

  const runStudyPlan = useCallback(() => runCommand(STUDY_COMMAND), [runCommand]);
  const runSleepPlan = useCallback(() => runCommand(SLEEP_COMMAND), [runCommand]);
  const runSleepOncePlan = useCallback(() => runCommand(SLEEP_ONCE_COMMAND), [runCommand]);

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
      const ended = await endContextLifecycle(active.session.id, {
        registry: device,
        snapshots,
        hooks: sessionHooks,
        policy: borrowedPolicy,
      });
      const { state, results, summary, cleared, retryable } = ended;

      // A6.5: mirror the ending too, so a second screen sees WHAT went back and not merely that
      // something did. Software/session-sync only.
      void mirrorContextEnd(ended, sessionSync, { profileId: active.session.profileId });

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

      <Pressable style={[styles.btn, styles.btnWide]} onPress={onBack}>
        <Text style={styles.btnText}>← Back to Ally</Text>
      </Pressable>

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

      {/*
        SPIKE ONLY. `ringer` has reported not_supported since Phase 2 and this is the button that
        finds out whether that is still honest. It changes the real ringer for ~30s and puts the
        original back in a finally. Nothing in the action engine calls it.
      */}
      <Pressable
        style={[styles.btn, styles.btnProbe]}
        onPress={() => {
          setProbe({ status: 'ringer spike running — ~30s, restores your mode at the end' });
          void allyNativeSpike()
            .then((r) => setProbe(r))
            .catch((e: unknown) => setProbe({ error: String(e) }));
        }}
      >
        <Text style={styles.btnText}>SPIKE: ringer</Text>
      </Pressable>

      <Pressable style={[styles.btn, styles.btnProbe]} onPress={onOpenPriority}>
        <Text style={styles.btnText}>Open Priority screen</Text>
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
      <Pressable style={[styles.btn, styles.btnProbe]} onPress={onOpenActive}>
        <Text style={styles.btnText}>Open Active Context</Text>
      </Pressable>
      <Text style={styles.info}>
        End context reads the session from the database, so it still works after the app has been
        force-stopped and reopened. That is the A-V2 proof.
      </Text>

      <View style={styles.divider} />
      <Text style={styles.section}>Sleep &amp; wake-up alarm (Phase 5)</Text>
      <Text style={styles.info}>
        The alarm goes to your phone&apos;s OWN Clock app through AlarmClock intents, so Android
        owns it — not Ally. There is no public API to read the Clock back, so &quot;Applied&quot;
        here means a real Clock activity accepted the request; open the Clock to see the alarm
        itself. Recurrence comes from the sentence, never invented.
      </Text>
      <Pressable style={[styles.btn, styles.btnProbe]} onPress={() => void runSleepPlan()}>
        <Text style={styles.btnText}>Sleep + 7 AM WEEKDAY alarm</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.btnProbe]} onPress={() => void runSleepOncePlan()}>
        <Text style={styles.btnText}>Sleep + 7 AM ONE-SHOT alarm</Text>
      </Pressable>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => showClockAlarms()}>
          <Text style={styles.btnText}>Open stock Clock</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() => setProbe({ verdict: 'dismiss', ...(dismissAllyAlarm(null) ?? {}) })}
        >
          <Text style={styles.btnText}>Dismiss Ally&apos;s alarm</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setProbe(alarmDebugState())}>
          <Text style={styles.btnText}>Alarm state</Text>
        </Pressable>
      </View>

      <View style={styles.divider} />
      <Text style={styles.section}>Learned preference (Phase 4)</Text>
      <Text style={styles.info}>
        Stands in for the teaching command, which does not exist yet: Shlok&apos;s parser classifies
        &quot;remember I prefer {TAUGHT_BRIGHTNESS}% when studying&quot; as operation: teach, and
        nothing consumes that. These two buttons call Dhrey&apos;s preference repository directly —
        the same rows a real teach handler will write. Teach, then run the Study sentence:
        brightness should go to {TAUGHT_BRIGHTNESS}%, not the 40% study.json asks for, and END must
        still return the exact value you started from.
      </Text>
      <Text style={styles.info}>
        remembered: <Text style={styles.strong}>{taught}</Text>
      </Text>
      <Pressable style={[styles.btn, styles.btnProbe]} onPress={() => void teachBrightness()}>
        <Text style={styles.btnText}>Teach {TAUGHT_BRIGHTNESS}% brightness for Study</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.btnProbe]} onPress={() => void forgetTaught()}>
        <Text style={styles.btnText}>Forget taught preferences</Text>
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
  backBtn: { backgroundColor: '#232A35', padding: 14, alignItems: 'center' },
  btnText: { color: '#F5F7FA', fontSize: 13, fontWeight: '600' },
  result: { marginTop: 10, gap: 3 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  resultText: { color: '#C7CEDA', fontSize: 13 },
  resultMsg: { color: '#6B7688', fontSize: 12 },
});
