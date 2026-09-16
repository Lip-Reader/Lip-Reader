import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { enrollVoice, getVoices, selectVoice, Voice } from "../../lib/api";
import { GlassButton } from "../../ui";
import { colors, fontFamily, radius } from "../../ui/theme";
import { CameraPreview, RecorderProvider, useRecorder } from "../talk/recorder";
import { useSettings } from "./settingsStore";

export default function VoicePicker() {
  const { voiceId, setVoiceId } = useSettings();
  const [tab, setTab] = useState<"preset" | "record">("preset");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVoices()
      .then(setVoices)
      .catch(() => setError("Couldn't load voices."))
      .finally(() => setLoading(false));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? voices.filter((v) => [v.name, v.description, v.gender].some((s) => (s || "").toLowerCase().includes(q)))
    : voices;

  async function choose(id: string) {
    setError(null);
    try {
      await selectVoice(id);
      await setVoiceId(id);
    } catch {
      setError("Couldn't save that voice. Try again.");
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.tabs}>
        {(["preset", "record"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]} accessibilityRole="tab">
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === "preset" ? "Voices" : "Record my voice"}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      {tab === "preset" ? (
        <>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search voices"
            placeholderTextColor={colors.muted}
            style={styles.input}
            accessibilityLabel="Search voices"
          />
          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
          ) : (
            <View style={{ gap: 8 }}>
              {filtered.map((v) => {
                const active = v.id === voiceId;
                return (
                  <Pressable key={v.id} onPress={() => choose(v.id)} style={[styles.voice, active && styles.voiceActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.voiceName}>{v.name}</Text>
                      {!!v.description && <Text style={styles.voiceDesc}>{v.description}</Text>}
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={22} color={colors.accent} />}
                  </Pressable>
                );
              })}
              {filtered.length === 0 && <Text style={styles.voiceDesc}>No voices match.</Text>}
            </View>
          )}
        </>
      ) : (
        <RecorderProvider>
          <RecordVoice onDone={choose} />
        </RecorderProvider>
      )}
    </View>
  );
}

function RecordVoice({ onDone }: { onDone: (id: string) => Promise<void> }) {
  const recorder = useRecorder();
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (await recorder.start()) setState("recording");
  }

  async function stop() {
    setState("uploading");
    const clip = await recorder.stop();
    if (!clip) return setState("idle");
    try {
      await onDone(await enrollVoice(clip));
    } catch {
      setError("Couldn't create the voice. Try again.");
    }
    setState("idle");
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.preview}>
        <CameraPreview />
      </View>
      <Text style={styles.voiceDesc}>Read a few sentences out loud for about 20 seconds, then stop.</Text>
      {(error || recorder.error) && <Text style={styles.error}>{error || recorder.error}</Text>}
      {state === "idle" && <GlassButton label="Start recording" variant="primary" onPress={start} disabled={!recorder.ready} />}
      {state === "recording" && <GlassButton label="Stop" variant="danger" onPress={stop} />}
      {state === "uploading" && <ActivityIndicator color={colors.accent} />}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.5)", borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: "center" },
  tabActive: { backgroundColor: colors.white },
  tabText: { color: colors.muted, fontWeight: "600", fontSize: 14, fontFamily },
  tabTextActive: { color: colors.text },
  input: {
    backgroundColor: colors.glassStrong,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    fontFamily,
  },
  voice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  voiceActive: { borderColor: colors.accent },
  voiceName: { fontSize: 16, fontWeight: "600", color: colors.text, fontFamily },
  voiceDesc: { fontSize: 13, color: colors.muted, marginTop: 2, fontFamily },
  error: { color: colors.danger, fontSize: 14, fontFamily },
  preview: { height: 220, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#000" },
});
