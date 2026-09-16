import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SettingsProvider } from "../src/features/settings/settingsStore";
import { warmBackend } from "../src/lib/api";
import { AuthProvider } from "../src/lib/auth";
import { colors } from "../src/ui/theme";

export default function RootLayout() {
  useEffect(warmBackend, []);
  return (
    <AuthProvider>
      <SettingsProvider>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg0 } }} />
        </SafeAreaProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
