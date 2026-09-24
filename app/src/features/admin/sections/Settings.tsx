import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { admin, getVoices, Voice } from "../../../lib/api";
import { colors, fontFamily, radius } from "../../../ui/theme";
import { Card, ErrorText, Loading, SmallButton } from "../ui";
import { useAdminData } from "../useAdminData";

export default function Settings() {
  const load = useCallback(async (t: string | null) => ({ settings: await admin.settings(t), voices: await getVoices().catch(() => [] as Voice[]) }), []);
  const { data, error, loading, getToken } = useAdminData(load);
  const [voice, setVoice] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setVoice(data.settings.default_voice_id);
    setEnabled(data.settings.lip_reading_enabled);
    setShowRaw(data.settings.show_vsr_output);
  }, [data]);

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      await admin.patchSettings(await getToken(), { default_voice_id: voice, lip_reading_enabled: enabled, show_vsr_output: showRaw });
      setNote("Saved");
    } catch {
      setNote("Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <Loading />;
  return (
    <View style={{ gap: 14 }}>
      <ErrorText text={error} />
      <Card title="Default voice">
        <Text style={styles.hint}>Used for new users and guests who haven't picked a voice.</Text>
        <View style={styles.chips}>
          {(data?.voices || []).map((v) => (
            <Pressable key={v.id} onPress={() => setVoice(v.id)} style={[styles.chip, voice === v.id && styles.chipActive]}>
              <Text style={[styles.chipText, voice === v.id && { color: colors.white }]}>{v.name}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card title="Lip reading">
        <View style={styles.switchRow}>
          <Text style={styles.hint}>Enable the Talk button for everyone.</Text>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.accent }} />
        </View>
      </Card>
      <Card title="Show what the model read">
        <View style={styles.switchRow}>
          <Text style={styles.hint}>Show the raw lip-reading under the sentence on the Talk screen for admins. Other users only ever see the final sentence.</Text>
          <Switch value={showRaw} onValueChange={setShowRaw} trackColor={{ true: colors.accent }} />
        </View>
      </Card>
      <View style={styles.saveRow}>
        <SmallButton label={saving ? "Saving…" : "Save"} primary onPress={save} disabled={saving} />
        {note && <Text style={styles.hint}>{note}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: colors.muted, fontFamily, flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text, fontFamily },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
