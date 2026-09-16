import { SignIn } from "@clerk/expo/web";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Background, IconButton } from "../../ui";
import { colors } from "../../ui/theme";

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <Background>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <IconButton name="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        </View>
        <SignIn
          routing="hash"
          forceRedirectUrl="/talk"
          signUpForceRedirectUrl="/talk"
          appearance={{
            variables: { colorPrimary: colors.accent, borderRadius: "18px", fontFamily: "Inter, system-ui, sans-serif" },
            elements: { cardBox: { boxShadow: "0 8px 28px rgba(99,91,255,0.14)", borderRadius: 28 } },
          }}
        />
      </ScrollView>
    </Background>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, alignItems: "center", paddingHorizontal: 16, gap: 16 },
  header: { width: "100%", maxWidth: 520, paddingVertical: 6 },
});
