import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { enrollPhrase, getPhrases, getPhraseTemplates, Phrase, PhraseBank as Bank, resetPhraseTemplates } from "../../lib/api";
import { GlassButton, IconButton } from "../../ui";
import { colors, fontFamily, radius } from "../../ui/theme";
import { CameraPreview, RecorderProvider, useRecorder } from "../talk/recorder";
import Segmented from "./Segmented";
import { useSettings } from "./settingsStore";

const TARGET = 3;

export default function PhraseBank() {
  const { patientKey, gender, setGender } = useSettings();
  const [bank, setBank] = useState<Bank | null>(null);
  const [takes, setTakes] = useState<Record<string, number>>({});
  const [seed, setSeed] = useState<string[]>([]);
  const [storageOn, setStorageOn] = useState(true);
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Phrase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    getPhrases("he")
      .then((b) => {
        setBank(b);
        setGroup(b.groups[0]?.id ?? "");
      })
      .catch(() => setError("לא ניתן היה לטעון את רשימת המשפטים."));
  }, []);

  useEffect(() => {
    if (!patientKey) return;
    getPhraseTemplates(patientKey)
      .then((t) => {
        setTakes(t.takes);
        setSeed(t.seed_phrases);
        setStorageOn(t.storage);
      })
      .catch(() => {});
  }, [patientKey]);

  const text = (p: Phrase) => (gender === "f" ? p.text_f : p.text_m);
  const q = query.trim();
  const shown = useMemo(() => {
    if (!bank) return [];
    if (q) return bank.phrases.filter((p) => p.text_m.includes(q) || p.text_f.includes(q));
    return bank.phrases.filter((p) => p.group === group);
  }, [bank, q, group]);
  const taught = Object.values(takes).filter((n) => n > 0).length;

  async function resetAll() {
    if (!patientKey) return;
    setResetting(true);
    setResetError(null);
    try {
      await resetPhraseTemplates(patientKey);
      setTakes({});
      setConfirmReset(false);
    } catch (e) {
      setResetError(e instanceof Error && e.message ? e.message : "לא ניתן היה לאפס את המשפטים. נסו שוב.");
    }
    setResetting(false);
  }

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!bank) return <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />;

  if (active) {
    return (
      <RecorderProvider>
        <EnrollPanel
          phrase={active}
          text={text(active)}
          takes={takes[active.id] ?? 0}
          patientKey={patientKey}
          onTake={(n) => setTakes((t) => ({ ...t, [active.id]: n }))}
          onDone={() => setActive(null)}
        />
      </RecorderProvider>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Segmented
        value={gender}
        onChange={setGender}
        options={[
          { value: "m", label: "זכר", testID: "gender-m" },
          { value: "f", label: "נקבה", testID: "gender-f" },
        ]}
      />
      <View style={styles.progressRow}>
        <Text style={styles.muted} testID="phrase-progress">
          {taught} מתוך {bank.phrases.length} משפטים נלמדו{storageOn ? "" : " · השמירה כבויה בשרת הזה"}
        </Text>
        {taught > 0 && patientKey && !confirmReset && (
          <Pressable onPress={() => setConfirmReset(true)} accessibilityRole="button" testID="phrase-reset">
            <Text style={styles.resetLink}>איפוס</Text>
          </Pressable>
        )}
        {confirmReset && (
          <View style={styles.resetConfirmRow}>
            <Text style={styles.muted}>לאפס הכל?</Text>
            <Pressable onPress={resetAll} disabled={resetting} accessibilityRole="button" testID="phrase-reset-confirm">
              <Text style={styles.resetConfirmYes}>{resetting ? "מאפס..." : "כן, איפוס"}</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmReset(false)} disabled={resetting} accessibilityRole="button" testID="phrase-reset-cancel">
              <Text style={styles.muted}>ביטול</Text>
            </Pressable>
          </View>
        )}
      </View>
      {resetError && <Text style={styles.error}>{resetError}</Text>}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="חיפוש"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.rtl]}
        accessibilityLabel="Search phrases"
        testID="phrase-search"
      />
      {!q && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {bank.groups.map((g) => {
            const on = g.id === group;
            return (
              <Pressable key={g.id} onPress={() => setGroup(g.id)} style={[styles.chip, on && styles.chipActive]} accessibilityRole="tab" testID={`group-${g.id}`}>
                <Text style={[styles.chipText, on && styles.chipTextActive]}>{g.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }} nestedScrollEnabled>
        {shown.map((p) => {
          const n = takes[p.id] ?? 0;
          return (
            <Pressable key={p.id} onPress={() => setActive(p)} style={styles.row} accessibilityRole="button" testID={`phrase-${p.id}`}>
              <View style={[styles.badge, n >= TARGET && styles.badgeDone]}>
                <Text style={[styles.badgeText, n >= TARGET && styles.badgeTextDone]}>
                  {Math.min(n, TARGET)}/{TARGET}
                </Text>
              </View>
              <Text style={[styles.phrase, styles.rtl]}>{text(p)}</Text>
              {seed.includes(p.id) && <Text style={styles.seed}>seed</Text>}
            </Pressable>
          );
        })}
        {shown.length === 0 && <Text style={styles.muted}>לא נמצאו משפטים תואמים.</Text>}
      </ScrollView>
    </View>
  );
}

function EnrollPanel({
  phrase,
  text,
  takes,
  patientKey,
  onTake,
  onDone,
}: {
  phrase: Phrase;
  text: string;
  takes: number;
  patientKey: string | null;
  onTake: (n: number) => void;
  onDone: () => void;
}) {
  const recorder = useRecorder();
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(takes);

  async function start() {
    setError(null);
    if (await recorder.start()) setState("recording");
  }

  async function stop() {
    setState("uploading");
    const clip = await recorder.stop();
    if (!clip || !patientKey) return setState("idle");
    try {
      const r = await enrollPhrase(clip, patientKey, phrase.id);
      setCount(r.takes);
      onTake(r.takes);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "לא ניתן היה לשמור את ההקלטה. נסו שוב.");
    }
    setState("idle");
  }

  const next = Math.min(count, TARGET) + 1;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.enrollHeader}>
        <IconButton name="chevron-back" label="חזרה" onPress={onDone} testID="enroll-back" />
        <Text style={styles.enrollHeaderTitle}>המשפטים שלי</Text>
      </View>
      <View style={styles.preview}>
        <CameraPreview />
      </View>
      <Text style={[styles.bigPhrase, styles.rtl]} testID="enroll-phrase">
        {text}
      </Text>
      <Text style={styles.muted} testID="enroll-status">
        {count >= TARGET ? `נלמד עם ${count} הקלטות. אפשר להוסיף עוד או לסיים.` : `לקיחה ${next} מתוך ${TARGET}. בטאו את המשפט, ואז עצרו.`}
      </Text>
      {(error || recorder.error) && <Text style={styles.error}>{error || recorder.error}</Text>}
      {state === "idle" && <GlassButton label="הקלטה" variant="primary" onPress={start} disabled={!recorder.ready} testID="enroll-record" />}
      {state === "recording" && <GlassButton label="עצור" variant="danger" onPress={stop} testID="enroll-stop" />}
      {state === "uploading" && <ActivityIndicator color={colors.accent} />}
      <GlassButton label="סיום" onPress={onDone} testID="enroll-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  rtl: { writingDirection: "rtl", textAlign: "right" },
  muted: { fontSize: 13, color: colors.muted, fontFamily },
  error: { color: colors.danger, fontSize: 14, fontFamily },
  progressRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  resetLink: { fontSize: 13, fontWeight: "600", color: colors.danger, fontFamily },
  resetConfirmRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  resetConfirmYes: { fontSize: 13, fontWeight: "700", color: colors.danger, fontFamily },
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
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontWeight: "600", fontSize: 14, fontFamily },
  chipTextActive: { color: colors.white },
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
  badge: { minWidth: 40, paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: "rgba(30,27,75,0.08)", alignItems: "center" },
  badgeDone: { backgroundColor: colors.success },
  badgeText: { fontSize: 12, fontWeight: "600", color: colors.muted, fontFamily },
  badgeTextDone: { color: colors.white },
  phrase: { flex: 1, fontSize: 17, fontWeight: "500", color: colors.text, fontFamily },
  seed: { fontSize: 11, color: colors.accent, fontFamily },
  enrollHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },
  enrollHeaderTitle: { fontSize: 16, fontWeight: "600", color: colors.text, fontFamily },
  preview: { height: 420, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#000" },
  bigPhrase: { fontSize: 28, fontWeight: "600", color: colors.text, fontFamily, lineHeight: 36 },
});
