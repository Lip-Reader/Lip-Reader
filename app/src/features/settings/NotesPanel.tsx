import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { t } from "../../lib/i18n";
import { GlassButton } from "../../ui";
import { colors, fontFamily, radius } from "../../ui/theme";
import { canListen, startListening } from "../talk/listener";
import { useSettings } from "./settingsStore";

const MAX_NOTES = 9;
const MAX_CHARS = 10000;

export default function NotesPanel() {
  const { language, notes, setNotes } = useSettings();
  /** index being edited, -1 for a new note, null when the list is showing */
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [dictation, setDictation] = useState<{ stop: () => Promise<string> } | null>(null);

  function open(index: number) {
    setDraft(index < 0 ? "" : notes[index]);
    setEditing(index);
  }

  function close() {
    dictation?.stop();
    setDictation(null);
    setEditing(null);
    setDraft("");
  }

  function save() {
    const text = draft.trim().slice(0, MAX_CHARS);
    if (!text || editing === null) return;
    const next = [...notes];
    if (editing < 0) next.push(text);
    else next[editing] = text;
    setNotes(next);
    close();
  }

  // Safari only lets speech recognition start straight from the tap, so nothing is
  // awaited before startListening.
  function dictate() {
    if (dictation) {
      setDictation(null);
      dictation.stop().then((heard) => {
        if (heard) setDraft((d) => (d ? `${d} ${heard}` : heard));
      });
      return;
    }
    setDictation(startListening(language));
  }

  if (editing !== null) {
    return (
      <View style={{ gap: 12 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t(language, "notePlaceholder")}
          placeholderTextColor={colors.muted}
          multiline
          style={styles.input}
          accessibilityLabel={t(language, "noteAddLabel")}
          testID="note-input"
        />
        {canListen() && (
          <GlassButton
            label={t(language, dictation ? "noteStopLabel" : "noteDictateLabel")}
            variant={dictation ? "danger" : "ghost"}
            onPress={dictate}
            testID="note-dictate"
          />
        )}
        <GlassButton label={t(language, "noteSaveLabel")} variant="primary" onPress={save} disabled={!draft.trim()} testID="note-save" />
        <GlassButton label={t(language, "noteCancelLabel")} onPress={close} testID="note-cancel" />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {notes.length === 0 && <Text style={styles.muted}>{t(language, "notesEmptyLabel")}</Text>}
      {notes.map((note, i) => (
        <View key={i} style={styles.row} testID={`note-${i}`}>
          <Text style={styles.note}>{note}</Text>
          <Pressable onPress={() => open(i)} accessibilityRole="button" testID={`note-edit-${i}`}>
            <Text style={styles.edit}>{t(language, "noteEditLabel")}</Text>
          </Pressable>
          <Pressable
            onPress={() => setNotes(notes.filter((_, j) => j !== i))}
            accessibilityRole="button"
            testID={`note-delete-${i}`}
          >
            <Text style={styles.delete}>{t(language, "noteDeleteLabel")}</Text>
          </Pressable>
        </View>
      ))}
      {notes.length >= MAX_NOTES && <Text style={styles.muted}>{t(language, "notesFullLabel")}</Text>}
      <GlassButton
        label={t(language, "noteAddLabel")}
        variant="primary"
        onPress={() => open(-1)}
        disabled={notes.length >= MAX_NOTES}
        testID="note-add"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: colors.muted, fontFamily },
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
  note: { flex: 1, fontSize: 16, color: colors.text, fontFamily },
  edit: { fontSize: 13, fontWeight: "600", color: colors.accent, fontFamily },
  delete: { fontSize: 13, fontWeight: "600", color: colors.danger, fontFamily },
  input: {
    minHeight: 96,
    backgroundColor: colors.white,
    borderColor: "rgba(30,27,75,0.28)",
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    color: colors.text,
    textAlignVertical: "top",
    fontFamily,
  },
});
