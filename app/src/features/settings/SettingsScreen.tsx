import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendSupport } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { Background, Body, GlassButton, GlassPanel, IconButton, Title } from "../../ui";
import { colors, fontFamily, radius } from "../../ui/theme";
import VoicePicker from "./VoicePicker";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  async function send() {
    if (!message.trim()) return;
    try {
      await sendSupport(await session.getToken(), message.trim());
      setMessage("");
      setSent("Thanks, your message was sent.");
    } catch {
      setSent("Couldn't send right now. Try again later.");
    }
  }

  return (
    <Background>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <IconButton name="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/talk"))} testID="back-button" />
          <Title>Settings</Title>
        </View>

        <Section title="Voice" hint="This is how Chaplin will speak for you.">
          <VoicePicker />
        </Section>

        <Section title="Account">
          {session.signedIn ? (
            <>
              <Body>{session.email}</Body>
              <GlassButton label="Sign out" onPress={() => session.signOut()} testID="signout-button" />
            </>
          ) : (
            <>
              <Body muted>{session.enabled ? "Sign in to keep your settings on every device." : "Settings are saved on this device."}</Body>
              {session.enabled && <GlassButton label="Sign in" variant="primary" onPress={() => router.push("/sign-in")} testID="signin-button" />}
            </>
          )}
        </Section>

        <Section title="Feedback">
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Tell us what would help"
            placeholderTextColor={colors.muted}
            multiline
            style={styles.textarea}
            accessibilityLabel="Feedback"
          />
          {sent && <Body muted>{sent}</Body>}
          <GlassButton label="Send" onPress={send} disabled={!message.trim()} testID="feedback-send" />
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
