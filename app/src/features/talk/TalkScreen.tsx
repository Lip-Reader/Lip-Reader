import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Candidate, ClipFile, executeLips, getPublicSettings, logRun, nbestOf, pingVsr, vsrAvailable } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { t } from "../../lib/i18n";
import { Background, FixedControls, GlassButton, GlassPanel, IconButton, Toast } from "../../ui";
import { absoluteFill, colors, fontFamily } from "../../ui/theme";
import { useSettings } from "../settings/settingsStore";
import { CameraPreview, RecorderProvider, useRecorder } from "./recorder";
import { useSpeaker } from "./speaker";

type Phase = "idle" | "recording" | "thinking" | "choose" | "review";

export default function TalkScreen() {
  return (
    <RecorderProvider>
      <Talk />
    </RecorderProvider>
  );
}

function Talk() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { voiceId, language, gender, patientKey, ready: settingsReady } = useSettings();
  const recorder = useRecorder();
  const speaker = useSpeaker();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rawResult, setRawResult] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [warm, setWarm] = useState<"warming" | "ready" | "unavailable">("warming");
  const hideToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    let stop = false;
    (async () => {
      for (let i = 0; i < 30 && !stop; i++) {
        if (await pingVsr()) return stop || setWarm("ready");
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!stop) setWarm("unavailable");
    })();
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    getPublicSettings()
      .then((s) => setPaused(!s.lip_reading_enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  async function talk() {
    speaker.reset();
    setText("");
    setCandidates([]);
    if (!(await recorder.start())) return setToast(t(language, "cameraNotReady"));
    setPhase("recording");
  }

  function reset() {
    speaker.reset();
    setText("");
    setCandidates([]);
    setPhase("idle");
  }

  async function stop() {
    setPhase("thinking");
    const clip = await recorder.stop();
    if (!clip) return setPhase("idle");
    await processClip(clip);
  }

  async function upload() {
    if (!recorder.pickClip) return;
    const clip = await recorder.pickClip();
    if (!clip) return;
    // phone captures often report an empty type; only reject one we can see is wrong
    if (clip instanceof File && clip.type && !clip.type.startsWith("video/")) {
      return setToast(t(language, "notAVideoToast"));
    }
    speaker.reset();
    setText("");
    setCandidates([]);
    setPhase("thinking");
    await processClip(clip);
  }

  async function processClip(clip: ClipFile) {
    const t0 = Date.now();
    setStartedAt(t0);
    try {
      const result = await executeLips(clip, { language, patientKey, gender });
      setRawResult(result.raw);
      if (language === "he" && !result.confident && result.candidates?.length) {
        setCandidates(result.candidates);
        setPhase("choose");
        return;
      }
      setText(result.response);
      setPhase("review");
      logRun(await session.getToken(), result.raw, result.response, Date.now() - t0, recorder.framingRef?.current, nbestOf(result));
    } catch (e) {
      const known = e instanceof Error && e.message && !e.message.startsWith("/api/");
      setToast(
        !(await vsrAvailable())
          ? t(language, "vsrUnavailableToast")
          : known
            ? (e as Error).message
            : t(language, "genericErrorToast")
      );
      setPhase("idle");
    }
  }

  async function choose(c: Candidate) {
    setText(c.text);
    setPhase("review");
    logRun(await session.getToken(), rawResult, c.text, Date.now() - startedAt, recorder.framingRef?.current);
  }

  const showText = phase === "review";
  const dim = phase === "review" || phase === "choose";
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <View style={styles.root}>
      <CameraPreview />
      {dim && <View style={styles.dim} />}

      <FixedControls>
        <IconButton name="settings-outline" label={t(language, "settingsLabel")} onPress={() => router.push("/settings")} testID="settings-button" />
        <View style={styles.rightControls}>
          {(phase === "review" || phase === "choose") && (
            <IconButton name="refresh-outline" label={t(language, "resetLabel")} onPress={reset} testID="reset-button" />
          )}
          <IconButton
            name="camera-reverse-outline"
            label={t(language, "flipCameraLabel")}
            onPress={recorder.flip}
            disabled={phase === "recording"}
            testID="flip-camera-button"
          />
          {session.isAdmin && (
            <IconButton name="shield-checkmark-outline" label={t(language, "adminLabel")} onPress={() => router.push("/admin")} testID="admin-button" />
          )}
        </View>
      </FixedControls>

      <Toast text={toast} onHide={hideToast} />

      {phase === "recording" && (
        <View style={[styles.pill, { top: insets.top + 64 }]}>
          <View style={styles.dot} />
          <Text style={styles.pillText}>{t(language, "listeningLabel")} · {mmss}</Text>
        </View>
      )}

      {phase === "thinking" && (
        <View style={styles.center}>
          <View style={styles.spinnerBox}>
            <ActivityIndicator size="large" color={colors.white} />
          </View>
        </View>
      )}

      {phase === "choose" && (
        <View style={styles.sentenceBox}>
          <View style={styles.chooseBox}>
            <Text style={styles.chooseTitle}>{t(language, "whichOne")}</Text>
            {candidates.map((c, i) => (
              <GlassButton key={c.id} label={c.text} onPress={() => choose(c)} testID={`candidate-${i}`} />
            ))}
            <GlassButton label={t(language, "noneOfThese")} variant="danger" onPress={() => setPhase("idle")} testID="candidate-none" />
          </View>
        </View>
      )}

      {showText && (
        <View style={styles.sentenceBox}>
          <Text style={[styles.sentence, language === "he" && styles.rtl]} testID="sentence">
            {speaker.tokens.length > 0
              ? speaker.tokens.map((tk, i) => (
                  <Text key={i} style={{ opacity: i < speaker.spoken ? 1 : 0.4 }}>
                    {tk.t}
                  </Text>
                ))
              : text}
          </Text>
        </View>
      )}

      {/* only while idle: after an upload its full-screen background would cover the result */}
      {recorder.error && phase === "idle" && (
        <View style={styles.center}>
          <Background style={absoluteFill} />
          <GlassPanel style={styles.errorPanel}>
            <Ionicons name="videocam-off-outline" size={34} color={colors.accent} style={{ alignSelf: "center" }} />
            <Text style={styles.errorText}>
              {t(language, recorder.error === "denied" ? "cameraDeniedLabel" : "cameraFailedLabel")}
            </Text>
            <GlassButton label={t(language, "retryLabel")} variant="primary" onPress={recorder.retry} />
          </GlassPanel>
        </View>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {paused && <Text style={styles.paused}>{t(language, "pausedLabel")}</Text>}
        {!paused && warm === "warming" && (
          <Text style={styles.paused} testID="warming-note">{t(language, "warmingLabel")}</Text>
        )}
        {!paused && warm === "unavailable" && (
          <Text style={styles.paused} testID="unavailable-note">{t(language, "unavailableLabel")}</Text>
        )}
        {speaker.error && <Text style={styles.paused}>{speaker.error}</Text>}

        {phase === "idle" && !recorder.error && (
          <GlassButton label={t(language, "talkLabel")} onPress={talk} disabled={paused || !recorder.ready || !settingsReady} icon={<RecordDot />} testID="talk-button" />
        )}
        {/* also offered when the camera failed - uploading is the fallback for exactly that case */}
        {phase === "idle" && recorder.pickClip && (
          <GlassButton
            label={t(language, "uploadLabel")}
            onPress={upload}
            disabled={paused || !settingsReady}
            icon={<Ionicons name="cloud-upload-outline" size={18} color={colors.text} />}
            testID="upload-button"
          />
        )}
        {phase === "recording" && (
          <GlassButton label={t(language, "stopLabel")} variant="danger" onPress={stop} icon={<Ionicons name="stop" size={18} color={colors.white} />} testID="stop-button" />
        )}
        {phase === "review" && speaker.phase !== "playing" && (
          <>
            <GlassButton
              label={speaker.phase === "preparing" ? t(language, "preparingLabel") : t(language, "speakLabel")}
              variant="primary"
              disabled={speaker.phase === "preparing"}
              onPress={() => speaker.play(text, voiceId)}
              icon={<Ionicons name="volume-high" size={20} color={colors.white} />}
              testID="speak-button"
            />
            <GlassButton label={t(language, "talkLabel")} onPress={talk} icon={<RecordDot />} testID="talk-button" />
          </>
        )}
        {phase === "review" && speaker.phase === "playing" && (
          <GlassButton label={t(language, "stopLabel")} variant="danger" onPress={speaker.stop} icon={<Ionicons name="stop" size={18} color={colors.white} />} />
        )}
      </View>
    </View>
  );
}

const RecordDot = () => <View style={styles.recordDot} />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  dim: { ...absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  center: { ...absoluteFill, alignItems: "center", justifyContent: "center", zIndex: 20 },
  spinnerBox: { padding: 22, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)" },
  pill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    zIndex: 20,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  pillText: { color: colors.white, fontSize: 14, fontWeight: "500", fontFamily },
  sentenceBox: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "16%",
    bottom: "34%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  sentence: { color: colors.white, fontSize: 30, fontWeight: "600", textAlign: "center", lineHeight: 40, maxWidth: 520, fontFamily },
  rtl: { writingDirection: "rtl" },
  rightControls: { flexDirection: "row", gap: 10 },
  chooseBox: { width: "100%", maxWidth: 360, gap: 10 },
  chooseTitle: { color: colors.white, fontSize: 18, fontWeight: "600", textAlign: "center", marginBottom: 4, fontFamily },
  errorPanel: { width: "88%", maxWidth: 380 },
  errorText: { color: colors.text, fontSize: 16, textAlign: "center", marginVertical: 14, fontFamily },
  bottom: { position: "absolute", left: 20, right: 20, bottom: 0, gap: 12, alignItems: "center", zIndex: 30 },
  paused: { color: colors.white, fontSize: 14, fontWeight: "500", textAlign: "center", fontFamily },
  recordDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger },
});
