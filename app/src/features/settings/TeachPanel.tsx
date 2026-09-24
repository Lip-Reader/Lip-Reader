import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError, ExecuteResult, executeLips, logRun } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { StringKey, t } from "../../lib/i18n";
import { GlassButton } from "../../ui";
import { colors, fontFamily, radius } from "../../ui/theme";
import { CameraPreview, RecorderProvider, useRecorder } from "../talk/recorder";
import { useSettings } from "./settingsStore";

/** Why the service refused the clip -> the message the clinician sees. */
const REFUSALS: Record<string, StringKey> = {
  no_face: "noFaceToast",
  nothing_read: "nothingReadToast",
  still: "stillClipToast",
  no_rest: "noRestToast",
};

export default function TeachPanel() {
  return (
    <RecorderProvider>
      <Panel />
    </RecorderProvider>
  );
}

function Panel() {
  const { language, patientKey, gender, examples, setExamples, notes } = useSettings();
  const session = useSession();
  const recorder = useRecorder();
  const [state, setState] = useState<"idle" | "recording" | "reading" | "asking">("idle");
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [fix, setFix] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setResult(null);
    setFix(null);
    if (await recorder.start()) setState("recording");
  }

  async function stop() {
    setState("reading");
    const clip = await recorder.stop();
    if (!clip) return setState("idle");
    const started = Date.now();
    try {
      const r = await executeLips(clip, {
        language,
        patientKey,
        gender,
        durationMs: recorder.durationRef?.current,
        examples,
        notes,
      });
      setResult(r);
      setLatencyMs(Date.now() - started);
      setState("asking");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setError(code && REFUSALS[code] ? t(language, REFUSALS[code]) : e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  /** Keeps the confirmed sentence as an example, and logs the run either way. */
  async function answer(truth: string | null) {
    if (!result) return;
    if (truth) setExamples([...examples, { phrase: truth, model_output: result.wordOptions }]);
    setResult(null);
    setFix(null);
    setState("idle");
    logRun(await session.getToken(), {
      raw: result.raw,
      corrected: result.response,
      latencyMs,
      framing: recorder.framingRef?.current,
      wordOptions: result.wordOptions,
      notes,
      clipFps: result.clipFps,
      truth,
    });
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.preview}>
        <CameraPreview />
      </View>

      {(error || recorder.error) && <Text style={styles.error}>{error || recorder.error}</Text>}

      {state === "idle" && (
        <GlassButton label={t(language, "teachRecordLabel")} variant="primary" onPress={start} disabled={!recorder.ready} testID="teach-record" />
      )}
      {state === "recording" && <GlassButton label={t(language, "stopLabel")} variant="danger" onPress={stop} testID="teach-stop" />}
      {state === "reading" && (
        <View style={styles.readingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>{t(language, "teachAnalysingLabel")}</Text>
        </View>
      )}

      {state === "asking" && result && (
        <View style={{ gap: 12 }}>
          <Text style={styles.line} testID="teach-read">
            <Text style={styles.lineLabel}>{t(language, "teachReadLabel")}: </Text>
            {result.raw}
          </Text>
          <Text style={styles.line} testID="teach-chaplin">
            <Text style={styles.lineLabel}>{t(language, "teachChaplinLabel")}: </Text>
            {result.response}
          </Text>
          <Text style={styles.question}>{t(language, "teachQuestionLabel")}</Text>
          {fix === null ? (
            <>
              <GlassButton label={t(language, "teachYesLabel")} variant="primary" onPress={() => answer(result.response)} testID="teach-yes" />
              <GlassButton label={t(language, "teachNoLabel")} onPress={() => setFix(result.response)} testID="teach-no" />
              <GlassButton label={t(language, "teachSkipLabel")} onPress={() => answer(null)} testID="teach-skip" />
            </>
          ) : (
            <>
              <TextInput
                value={fix}
                onChangeText={setFix}
                placeholderTextColor={colors.muted}
                style={styles.input}
                accessibilityLabel={t(language, "teachNoLabel")}
                testID="teach-fix"
              />
              <GlassButton label={t(language, "teachSaveLabel")} variant="primary" onPress={() => answer(fix.trim())} disabled={!fix.trim()} testID="teach-save" />
            </>
          )}
        </View>
      )}

      <Text style={styles.muted} testID="teach-count">
        {examples.length} {t(language, "teachExamplesLabel")}
      </Text>
      {examples.length === 0 ? (
        <Text style={styles.muted}>{t(language, "teachEmptyLabel")}</Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }} nestedScrollEnabled>
          {examples.map((ex, i) => (
            <View key={i} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.phrase}>{ex.phrase}</Text>
                <Text style={styles.options} numberOfLines={2}>
                  {ex.model_output}
                </Text>
              </View>
              <Pressable
                onPress={() => setExamples(examples.filter((_, j) => j !== i))}
                accessibilityRole="button"
                accessibilityLabel={t(language, "teachDeleteLabel")}
                testID={`teach-delete-${i}`}
              >
                <Text style={styles.delete}>{t(language, "teachDeleteLabel")}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { height: 420, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#000" },
  muted: { fontSize: 13, color: colors.muted, fontFamily },
  error: { color: colors.danger, fontSize: 14, fontFamily },
  readingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  line: { fontSize: 17, color: colors.text, fontFamily },
  lineLabel: { fontWeight: "600", color: colors.muted },
  question: { fontSize: 18, fontWeight: "600", color: colors.text, fontFamily },
  input: {
    backgroundColor: colors.white,
    borderColor: "rgba(30,27,75,0.28)",
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    fontFamily,
  },
  list: { maxHeight: 330 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  phrase: { fontSize: 16, fontWeight: "500", color: colors.text, fontFamily },
  options: { fontSize: 12, color: colors.muted, fontFamily },
  delete: { fontSize: 13, fontWeight: "600", color: colors.danger, fontFamily },
});
