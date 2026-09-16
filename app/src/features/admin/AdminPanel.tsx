import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ComponentType, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../lib/auth";
import { Background, GlassButton, GlassPanel, IconButton, Title } from "../../ui";
import { bp, colors, fontFamily, radius } from "../../ui/theme";
import Info from "./sections/Info";
import Logs from "./sections/Logs";
import Overview from "./sections/Overview";
import Settings from "./sections/Settings";
import Support from "./sections/Support";
import Users from "./sections/Users";

type SectionId = "overview" | "users" | "logs" | "settings" | "support" | "info";

const SECTIONS: { id: SectionId; label: string; icon: keyof typeof Ionicons.glyphMap; group: "Monitor" | "Admin" }[] = [
  { id: "overview", label: "Overview", icon: "grid-outline", group: "Monitor" },
  { id: "users", label: "Users", icon: "people-outline", group: "Monitor" },
  { id: "logs", label: "Logs & audit", icon: "list-outline", group: "Monitor" },
  { id: "settings", label: "Settings", icon: "options-outline", group: "Admin" },
  { id: "support", label: "Support", icon: "chatbubble-ellipses-outline", group: "Admin" },
  { id: "info", label: "Info", icon: "information-circle-outline", group: "Admin" },
];

const VIEWS: Record<SectionId, ComponentType> = { overview: Overview, users: Users, logs: Logs, settings: Settings, support: Support, info: Info };

export default function AdminPanel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const { width } = useWindowDimensions();
  const [section, setSection] = useState<SectionId>("overview");
  const wide = width >= bp.lg;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/talk"));

  if (!session.enabled) return <Locked title="Admin is unavailable" body="Sign-in is not configured in this build." onBack={back} />;
  if (!session.loaded) return <Locked title="Checking your access…" body="One moment." onBack={back} />;
  if (!session.signedIn)
    return (
      <Locked title="Sign in to continue" body="The admin panel needs a signed-in account." onBack={back}>
        <GlassButton label="Sign in" variant="primary" onPress={() => router.push("/sign-in")} />
      </Locked>
    );
  if (!session.isAdmin) return <Locked title="You do not have access" body="This page is for admins only." onBack={back} />;

  const View_ = VIEWS[section];
  const nav = (horizontal: boolean) =>
    SECTIONS.map((s) => (
      <Pressable
        key={s.id}
        onPress={() => setSection(s.id)}
        accessibilityRole="tab"
        accessibilityState={{ selected: section === s.id }}
        testID={`admin-nav-${s.id}`}
        style={[styles.navItem, horizontal && styles.navItemH, section === s.id && styles.navItemActive]}
      >
        <Ionicons name={s.icon} size={18} color={section === s.id ? colors.accent : colors.muted} />
        <Text style={[styles.navText, section === s.id && { color: colors.text }]}>{s.label}</Text>
      </Pressable>
    ));

  return (
    <Background>
      <View style={[styles.shell, wide && styles.shellWide, { paddingTop: insets.top }]}>
        {wide ? (
          <View style={styles.rail}>
            <View style={styles.brand}>
              <IconButton name="chevron-back" label="Back to app" onPress={back} testID="admin-back" />
              <Text style={styles.brandText}>Chaplin</Text>
              <Text style={styles.pill}>admin</Text>
            </View>
            {(["Monitor", "Admin"] as const).map((g) => (
              <View key={g} style={{ gap: 2 }}>
                <Text style={styles.group}>{g}</Text>
                {nav(false).filter((_, i) => SECTIONS[i].group === g)}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.top}>
            <View style={styles.brand}>
              <IconButton name="chevron-back" label="Back to app" onPress={back} testID="admin-back" />
              <Text style={styles.brandText}>Chaplin</Text>
              <Text style={styles.pill}>admin</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
              {nav(true)}
            </ScrollView>
          </View>
        )}
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          <Title style={{ marginBottom: 4 }}>{SECTIONS.find((s) => s.id === section)?.label}</Title>
          <View_ />
        </ScrollView>
      </View>
    </Background>
  );
}

function Locked({ title, body, onBack, children }: { title: string; body: string; onBack: () => void; children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Background>
      <View style={[styles.locked, { paddingTop: insets.top + 12 }]}>
        <View style={styles.lockedHeader}>
          <IconButton name="chevron-back" label="Back" onPress={onBack} />
        </View>
        <GlassPanel style={styles.lockedPanel}>
          <Text style={styles.lockedTitle}>{title}</Text>
          <Text style={styles.lockedBody}>{body}</Text>
          {children}
        </GlassPanel>
      </View>
    </Background>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  shellWide: { flexDirection: "row" },
  rail: { width: 220, padding: 16, gap: 18, borderRightWidth: 1, borderRightColor: colors.glassBorder, backgroundColor: "rgba(255,255,255,0.35)" },
  top: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  brandText: { fontSize: 17, fontWeight: "600", color: colors.text, fontFamily },
  pill: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.accent,
    borderColor: "rgba(124,108,246,0.4)",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontFamily,
  },
  group: { fontSize: 11, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 10, paddingBottom: 6, fontFamily },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderRadius: radius.sm },
  navItemH: { paddingVertical: 7, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.45)" },
  navItemActive: { backgroundColor: colors.white },
  navText: { fontSize: 14, fontWeight: "500", color: colors.muted, fontFamily },
  tabsRow: { gap: 8, paddingBottom: 4 },
  content: { padding: 16, gap: 14, width: "100%", maxWidth: 1100, alignSelf: "center" },
  locked: { flex: 1, paddingHorizontal: 16, gap: 20 },
  lockedHeader: { width: "100%", maxWidth: 520, alignSelf: "center" },
  lockedPanel: { width: "100%", maxWidth: 420, alignSelf: "center", marginTop: 40 },
  lockedTitle: { fontSize: 22, fontWeight: "600", color: colors.text, fontFamily, textAlign: "center" },
  lockedBody: { fontSize: 15, color: colors.muted, fontFamily, textAlign: "center", marginVertical: 10 },
});
