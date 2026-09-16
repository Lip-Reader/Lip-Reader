import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../lib/auth";
import { Background, GlassButton, GlassPanel } from "../../ui";
import { bp, colors, fontFamily } from "../../ui/theme";

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; strong: string; rest: string }[] = [
  { icon: "videocam-outline", strong: "Reads your lips", rest: "from a short camera clip." },
  { icon: "sparkles-outline", strong: "Corrects the words", rest: "with an AI language model." },
  { icon: "volume-high-outline", strong: "Speaks the sentence", rest: "aloud in a natural voice." },
];

export default function LandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= bp.sm;
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
  }, [glow]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + glow.value * 0.3,
    transform: [{ scale: 1 + glow.value * 0.12 }],
  }));

  return (
    <Background>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.logoWrap}>
          <Animated.View style={[styles.glow, glowStyle]} />
          <Animated.View entering={FadeInUp.duration(700)}>
            <Image source={require("../../../public/chaplin_logo.png")} style={styles.logo} accessibilityLabel="Chaplin AI" />
          </Animated.View>
        </View>

        <Animated.Text entering={FadeInUp.delay(200).duration(700)} style={[styles.title, wide && { fontSize: 52 }]}>
          Chaplin AI
        </Animated.Text>
        <Animated.Text entering={FadeInUp.delay(450).duration(700)} style={[styles.tagline, wide && { fontSize: 24 }]}>
          A communication agent for non-vocal, ventilated patients.
        </Animated.Text>

        <View style={styles.features}>
          {FEATURES.map((f, i) => (
            <Animated.View key={f.strong} entering={FadeInUp.delay(750 + i * 300).duration(700)}>
              <GlassPanel style={styles.feature}>
                <View style={styles.featureRow}>
                  <View style={styles.featureIcon}>
                    <Ionicons name={f.icon} size={20} color={colors.accent} />
                  </View>
                  <Text style={styles.featureText}>
                    <Text style={styles.featureStrong}>{f.strong}</Text> {f.rest}
                  </Text>
                </View>
              </GlassPanel>
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={FadeInUp.delay(1750).duration(700)} style={styles.actions}>
          {session.signedIn ? (
            <GlassButton label="Continue" variant="primary" onPress={() => router.push("/talk")} testID="continue-button" />
          ) : (
            <>
              <GlassButton label="Try now" variant="primary" onPress={() => router.push("/talk")} testID="try-button" />
              {session.enabled && (
                <GlassButton label="Log in" onPress={() => router.push("/sign-in")} testID="login-button" />
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>
    </Background>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, alignItems: "center", paddingHorizontal: 24, gap: 14 },
  logoWrap: { width: 120, height: 120, alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", width: 140, height: 140, borderRadius: 70, backgroundColor: colors.accent },
  logo: { width: 96, height: 96 },
  title: { fontSize: 38, fontWeight: "700", color: colors.text, letterSpacing: -0.8, fontFamily, textAlign: "center" },
  tagline: { fontSize: 19, color: colors.text, textAlign: "center", maxWidth: 560, lineHeight: 28, fontFamily, fontWeight: "500" },
  features: { width: "100%", maxWidth: 520, gap: 12, marginTop: 14 },
  feature: {},
  featureRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(124,108,246,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, fontSize: 16, color: colors.text, lineHeight: 23, fontFamily },
  featureStrong: { fontWeight: "600", color: colors.accent },
  actions: { width: "100%", maxWidth: 360, gap: 12, marginTop: 20 },
});
