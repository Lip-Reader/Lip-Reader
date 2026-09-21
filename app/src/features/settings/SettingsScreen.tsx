import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendSupport } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { t } from "../../lib/i18n";
import { Background, Body, GlassButton, GlassPanel, IconButton, Title } from "../../ui";
import { colors, fontFamily, radius } from "../../ui/theme";
import { canListen } from "../talk/listener";
import PhraseBank from "./PhraseBank";
import Segmented from "./Segmented";
import { useSettings } from "./settingsStore";
import VoicePicker from "./VoicePicker";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { language, setLanguage, listen, setListen } = useSettings();
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  async function send() {
    if (!message.trim()) return;
    try {
      await sendSupport(await session.getToken(), message.trim());
      setMessage("");
      setSent(t(language, "feedbackSentMsg"));
    } catch {
      setSent(t(language, "feedbackErrorMsg"));
    }
  }

  return (
    <Background>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <IconButton name="chevron-back" label={t(language, "backLabel")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/talk"))} testID="back-button" />
          <Title>{t(language, "settingsTitle")}</Title>
        </View>

        <Section title={t(language, "languageSectionTitle")} hint={t(language, "languageSectionHint")}>
          <Segmented
            value={language}
            onChange={setLanguage}
            options={[
              { value: "en", label: "English", testID: "lang-en" },
              { value: "he", label: "עברית", testID: "lang-he" },
            ]}
          />
        </Section>

        {language === "he" && (
          <Section title={t(language, "phrasesSectionTitle")} hint={t(language, "phrasesSectionHint")}>
            <PhraseBank />
          </Section>
        )}

        <Section title={t(language, "voiceSectionTitle")} hint={t(language, "voiceSectionHint")}>
          <VoicePicker />
        </Section>

        {canListen() && (
          <Section title={t(language, "listenSectionTitle")} hint={t(language, "listenSectionHint")}>
            <Segmented
              value={listen ? "on" : "off"}
              onChange={(v) => setListen(v === "on")}
              options={[
                { value: "on", label: t(language, "onLabel"), testID: "listen-on" },
                { value: "off", label: t(language, "offLabel"), testID: "listen-off" },
              ]}
            />
          </Section>
        )}

        <Section title={t(language, "accountSectionTitle")}>
          {session.signedIn ? (
            <>
              <Body>{session.email}</Body>
              <GlassButton label={t(language, "signOutLabel")} onPress={() => session.signOut()} testID="signout-button" />
            </>
          ) : (
            <>
              <Body muted>{session.enabled ? t(language, "signInCloudHint") : t(language, "localOnlyHint")}</Body>
              {session.enabled && <GlassButton label={t(language, "signInLabel")} variant="primary" onPress={() => router.push("/sign-in")} testID="signin-button" />}
            </>
          )}
        </Section>

        <Section title={t(language, "feedbackSectionTitle")}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t(language, "feedbackPlaceholder")}
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.textarea, language === "he" && styles.rtl]}
            accessibilityLabel="Feedback"
          />
          {sent && <Body muted>{sent}</Body>}
          <GlassButton label={t(language, "feedbackSendLabel")} onPress={send} disabled={!message.trim()} testID="feedback-send" />
        </Section>
      </ScrollView>
    </Background>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <GlassPanel style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint && <Body muted style={{ marginBottom: 12 }}>{hint}</Body>}
      <View style={{ gap: 12 }}>{children}</View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 14, alignSelf: "center", width: "100%", maxWidth: 520 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 6 },
  section: {},
  sectionTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: 6, fontFamily },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  textarea: {
    minHeight: 96,
    backgroundColor: colors.glassStrong,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 16,
    color: colors.text,
    textAlignVertical: "top",
    fontFamily,
  },
});
