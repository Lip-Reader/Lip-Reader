import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Fragment, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, Candidate, ClipFile, executeLips, getPublicSettings, HebrewResult, logRun, pingVsr, vsrAvailable } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { StringKey, t } from "../../lib/i18n";
import { Background, FixedControls, GlassButton, GlassPanel, IconButton, Toast } from "../../ui";
import { absoluteFill, bp, colors, fontFamily, radius, shadow } from "../../ui/theme";
import { useSettings } from "../settings/settingsStore";
import { startListening } from "./listener";
import { CameraPreview, RecorderProvider, useRecorder } from "./recorder";
import type { Quality } from "./recorder.types";
import { useSpeaker } from "./speaker";

type Phase = "idle" | "recording" | "thinking" | "choose" | "review";

/** Why the service refused the clip, and what to tell the speaker about it. */
const CLIP_REFUSALS: Record<string, StringKey> = {
  no_face: "noFaceToast",
  nothing_read: "nothingReadToast",
  still: "stillClipToast",
  no_rest: "noRestToast",
  not_enrolled: "notEnrolledToast",
};

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
  const { voiceId, language, gender, patientKey, listen, examples, notes, ready: settingsReady } = useSettings();
  const recorder = useRecorder();
  const speaker = useSpeaker();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rawResult, setRawResult] = useState("");
  const [heard, setHeard] = useState("");
  const listenerRef = useRef<ReturnType<typeof startListening>>(null);
  // kept for the run log: a chosen candidate is logged after the result is gone
  const hebrewRef = useRef<HebrewResult | undefined>(undefined);
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
    setHeard("");
    // before any await: Safari only lets listening start straight from the tap
    listenerRef.current = listen ? startListening(language) : null;
    if (!(await recorder.start().catch(() => false))) {
      listenerRef.current?.stop(); // never leave the microphone on without a recording
      return setToast(t(language, "cameraNotReady"));
    }
    setPhase("recording");
  }

  function reset() {
    speaker.reset();
    setText("");
    setCandidates([]);
    setHeard("");
    setPhase("idle");
  }

  async function stop() {
    setPhase("thinking");
    const hearing = listenerRef.current?.stop();
    const clip = await recorder.stop();
    if (!clip) return setPhase("idle");
    await processClip(clip, hearing);
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
    setHeard("");
    setPhase("thinking");
    await processClip(clip);
  }

  async function processClip(clip: ClipFile, hearing?: Promise<string>) {
    const t0 = Date.now();
    setStartedAt(t0);
    try {
      const result = await executeLips(clip, {
        language,
        patientKey,
        gender,
        durationMs: recorder.durationRef?.current,
        examples: language === "en" ? examples : undefined,
        notes: language === "en" ? notes : undefined,
      });
      const said = (await hearing) ?? "";
      setHeard(said);
      setRawResult(result.raw);
      hebrewRef.current = result.hebrew;
      if (language === "he" && !result.confident && result.candidates?.length) {
        setCandidates(result.candidates);
        setPhase("choose");
        return;
      }
      setText(result.response);
      setPhase("review");
      logRun(await session.getToken(), {
        raw: result.raw,
        corrected: result.response,
        latencyMs: Date.now() - t0,
        framing: recorder.framingRef?.current,
        heard: said,
        wordOptions: result.wordOptions,
        notes: language === "en" ? notes : undefined,
        clipFps: result.clipFps,
        hebrew: language === "he" ? result.hebrew : undefined,
      });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      const known = e instanceof Error && e.message && !e.message.startsWith("/api/");
      setToast(
        code && code in CLIP_REFUSALS
          ? t(language, CLIP_REFUSALS[code])
          : !(await vsrAvailable())
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
    logRun(await session.getToken(), {
      raw: rawResult,
      corrected: c.text,
      latencyMs: Date.now() - startedAt,
      framing: recorder.framingRef?.current,
      heard,
      hebrew: hebrewRef.current,
      truth: c.id,
    });
  }

  const showText = phase === "review";
  const dim = phase === "review" || phase === "choose";
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <Frame>
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

        {(phase === "idle" || phase === "recording") && <QualityPill top={insets.top + 104} />}

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
            {/* in Hebrew the sentence is the phrase itself, so there is nothing to show */}
            {!!rawResult && language === "en" && (
              <Text style={styles.heard} testID="read">
                {t(language, "readLabel")}: {rawResult}
              </Text>
            )}
            {!!heard && (
              <Text style={[styles.heard, language === "he" && styles.rtl]} testID="heard">
                {t(language, "heardLabel")}: {heard}
              </Text>
            )}
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
    </Frame>
  );
}

/** On a desktop window the screen is a phone-sized card in the middle of the page, so
    the camera and the controls keep their shape. Everything inside positions against
    the card, not the window. Below 1024 the screen fills the window as before. */
function Frame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  if (width < bp.lg) return <>{children}</>;
  return (
    <Background style={absoluteFill}>
      <View style={styles.page}>
        <View style={[styles.frame, { height: Math.min(height - 48, 860) }]}>{children}</View>
      </View>
    </Background>
  );
}

const RecordDot = () => <View style={styles.recordDot} />;

const TONE = { good: colors.success, ok: colors.white, bad: colors.danger };

/** Live picture quality: green is best, white is fine, red is bad. The recorder smooths
    the numbers and holds each one until it really moves, so this gives a general sense. */
function QualityPill({ top }: { top: number }) {
  const { language } = useSettings();
  const { qualityRef } = useRecorder();
  const [q, setQ] = useState<Quality | null>(null);

  useEffect(() => {
    const id = setInterval(() => setQ(qualityRef?.current ?? null), 1000);
    return () => clearInterval(id);
  }, [qualityRef]);

  if (!q) return null;
  const note =
    q.grades.fill === "bad" ? t(language, q.fill > 50 ? "tooCloseLabel" : "tooFarLabel")
    : q.cutOff ? t(language, "cutOffLabel")
    : "";
  const parts = [
    ["light", "lightLabel", q.light],
    ["contrast", "contrastLabel", q.contrast],
    ["sharp", "sharpLabel", q.sharp],
    ["turn", "turnLabel", `${q.turn}°`],
    ["move", "moveLabel", q.move],
  ] as const;
  return (
    <View style={[styles.pill, styles.quality, { top }]} testID="quality-pill">
      <Text style={[styles.pillText, { color: TONE[q.grades.fill] }, language === "he" && styles.rtl]} testID="quality-distance">
        {q.face ? `~${q.distCm} ${t(language, "cmUnit")}${note && ` · ${note}`}` : t(language, "noFaceLabel")}
      </Text>
      <Text style={[styles.qualityText, language === "he" && styles.rtl]}>
        {parts.map(([key, label, value], i) => (
          <Fragment key={key}>
            {i > 0 && " · "}
            <Text style={{ color: TONE[q.grades[key]] }} testID={`quality-${key}`}>
              {t(language, label)} {q.face ? value : "–"}
            </Text>
          </Fragment>
        ))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  page: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: {
    width: 480,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.glassBorder,
    ...shadow,
  },
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
  quality: { flexDirection: "column", gap: 2, borderRadius: 18, maxWidth: "92%" },
  qualityText: { color: colors.white, fontSize: 12, textAlign: "center", opacity: 0.85, fontFamily },
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
  heard: { color: colors.white, fontSize: 16, textAlign: "center", opacity: 0.75, marginTop: 14, maxWidth: 520, fontFamily },
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
