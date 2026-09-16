import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../lib/auth";
import { Background, GlassButton, GlassPanel } from "../../ui";
import { bp, colors, fontFamily } from "../../ui/theme";

const STEPS = [
  { emoji: "🎥", title: "Look at the camera", text: "Mouth a short sentence." },
  { emoji: "✨", title: "Chaplin reads your lips", text: "And fixes the words with AI." },
  { emoji: "🔊", title: "Hear it out loud", text: "In a voice you choose." },
];

export default function LandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= bp.sm;
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [t]);
  const float = useAnimatedStyle(() => ({ transform: [{ translateY: -7 + t.value * 14 }] }));
  const row = width >= 720;

  return (
    <Background>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + (wide ? 56 : 36), paddingBottom: insets.bottom + 32 }]}>
        <Animated.View entering={FadeIn.duration(900)} style={styles.hero}>
          <Animated.View style={[styles.logoWrap, float]}>
            <Image source={require("../../../public/chaplin_logo.png")} style={styles.logo} accessibilityLabel="Chaplin AI" />
          </Animated.View>
        </Animated.View>

        <Animated.Text entering={FadeInUp.delay(250).duration(700)} style={[styles.title, wide && styles.titleWide]}>
          Chaplin AI
        </Animated.Text>
        <Animated.Text entering={FadeInUp.delay(450).duration(700)} style={[styles.tagline, wide && styles.taglineWide]}>
          Your lips, your voice. 💬
        </Animated.Text>
        <Animated.Text entering={FadeInUp.delay(600).duration(700)} style={styles.sub}>
          A communication agent for non-vocal, ventilated patients.
        </Animated.Text>

        <View style={[styles.steps, row && styles.stepsRow]}>
          {STEPS.map((s, i) => (
            <Animated.View key={s.title} entering={FadeInUp.delay(850 + i * 220).duration(650)} style={row && styles.stepWrapRow}>
              <GlassPanel liquid style={styles.step}>
                <View style={[styles.stepRow, row && styles.stepCol]}>
                  <View style={styles.emojiWrap}>
                    <Text style={styles.emoji}>{s.emoji}</Text>
                  </View>
                  <View style={[styles.stepText, row && { alignItems: "center" }]}>
                    <Text style={[styles.stepTitle, row && { textAlign: "center" }]}>{s.title}</Text>
                    <Text style={[styles.stepBody, row && { textAlign: "center" }]}>{s.text}</Text>
                  </View>
                </View>
              </GlassPanel>
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={FadeInUp.delay(1600).duration(700)} style={styles.actions}>
          {session.signedIn ? (
            <GlassButton label="Continue  →" variant="primary" onPress={() => router.push("/talk")} testID="continue-button" />
          ) : (
            <>
              <GlassButton label="Try now  →" variant="primary" onPress={() => router.push("/talk")} testID="try-button" />
              {session.enabled && <GlassButton label="Log in" onPress={() => router.push("/sign-in")} testID="login-button" />}
            </>
          )}
          <Text style={styles.note}>🔒 Video never leaves your device.</Text>
        </Animated.View>
      </ScrollView>
    </Background>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, alignItems: "center", paddingHorizontal: 24, gap: 10 },
  hero: { width: 160, height: 140, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  logoWrap: { width: 120, height: 120, alignItems: "center", justifyContent: "center" },
  logo: { width: 104, height: 104 },
  title: { fontSize: 40, fontWeight: "700", color: colors.text, letterSpacing: -1, fontFamily, textAlign: "center" },
  titleWide: { fontSize: 56 },
  tagline: { fontSize: 22, fontWeight: "600", color: colors.accent, textAlign: "center", fontFamily, marginTop: -2 },
  taglineWide: { fontSize: 26 },
  sub: { fontSize: 16, color: colors.muted, textAlign: "center", maxWidth: 420, lineHeight: 24, fontFamily },
  steps: { width: "100%", maxWidth: 520, gap: 12, marginTop: 18 },
  stepsRow: { maxWidth: 960, flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", justifyContent: "center" },
  stepWrapRow: { flexGrow: 1, flexBasis: 200, maxWidth: 320 },
  step: { flex: 1 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepCol: { flexDirection: "column", gap: 10, paddingVertical: 6 },
  emojiWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 26 },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 17, fontWeight: "600", color: colors.text, fontFamily },
  stepBody: { fontSize: 14, color: colors.muted, lineHeight: 20, fontFamily },
  actions: { width: "100%", maxWidth: 360, gap: 12, marginTop: 22, alignItems: "stretch" },
  note: { fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 4, fontFamily },
});
