import { isClerkAPIResponseError, useSignIn, useSignUp } from "@clerk/expo";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Background, Body, GlassButton, GlassPanel, IconButton, Title } from "../../ui";
import { colors, fontFamily, radius } from "../../ui/theme";

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, fetchStatus } = useSignIn();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = fetchStatus === "fetching";
  const done = () => router.replace("/talk");

  async function sendCode() {
    setError(null);
    const { error: e } = await signIn.emailCode.sendCode({ emailAddress: email.trim() });
    if (!e) return setMode("signin");
    const first = isClerkAPIResponseError(e) ? e.errors[0] : undefined;
    if (first?.code !== "form_identifier_not_found") return setError(first?.longMessage || "Couldn't send the code.");
    const { error: e2 } = await signUp.create({ emailAddress: email.trim() });
    if (e2) return setError((isClerkAPIResponseError(e2) && e2.errors[0]?.longMessage) || "Couldn't create the account.");
    await signUp.verifications.sendEmailCode();
    setMode("signup");
  }

  async function verify() {
    setError(null);
    if (mode === "signin") {
      const { error: e } = await signIn.emailCode.verifyCode({ code: code.trim() });
      if (e) return setError("That code didn't work.");
      if (signIn.status === "complete") await signIn.finalize({ navigate: done });
    } else {
      const { error: e } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (e) return setError("That code didn't work.");
      if (signUp.status === "complete") await signUp.finalize({ navigate: done });
    }
  }

  return (
    <Background>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <IconButton name="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
          <Title>Sign in</Title>
        </View>
        <GlassPanel>
          <View style={{ gap: 12 }}>
            {mode === null ? (
              <>
                <Body muted>We'll email you a one-time code. New here? The same code creates your account.</Body>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  style={styles.input}
                />
                <GlassButton label="Send code" variant="primary" onPress={sendCode} disabled={busy || !email.includes("@")} />
              </>
            ) : (
              <>
                <Body muted>Enter the code we sent to {email}.</Body>
                <TextInput value={code} onChangeText={setCode} placeholder="123456" placeholderTextColor={colors.muted} keyboardType="number-pad" style={styles.input} />
                <GlassButton label="Continue" variant="primary" onPress={verify} disabled={busy || code.trim().length < 4} />
                <GlassButton label="Use another email" onPress={() => { signIn.reset(); signUp.reset(); setMode(null); setCode(""); }} />
              </>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
            <View nativeID="clerk-captcha" />
          </View>
        </GlassPanel>
      </ScrollView>
    </Background>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 14, alignSelf: "center", width: "100%", maxWidth: 520 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 6 },
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
  error: { color: colors.danger, fontSize: 14, fontFamily },
});
