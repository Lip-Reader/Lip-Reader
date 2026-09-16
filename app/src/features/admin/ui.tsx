import { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, radius } from "../../ui/theme";

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <View style={styles.card}>
      {(title || actions) && (
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{title}</Text>
          {actions}
        </View>
      )}
      {children}
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function Badge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "good" | "bad" | "accent" }) {
  const bg = { neutral: "rgba(107,106,138,0.12)", good: "rgba(52,211,153,0.18)", bad: "rgba(248,113,113,0.18)", accent: "rgba(124,108,246,0.16)" }[tone];
  const fg = { neutral: colors.muted, good: "#0F8A5F", bad: "#B93B3B", accent: colors.accent }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Dot({ ok }: { ok: boolean }) {
  return <View style={[styles.dot, { backgroundColor: ok ? colors.success : colors.danger }]} />;
}

export function SmallButton({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.smallButton, primary && { backgroundColor: colors.accent, borderColor: colors.accent }, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text style={[styles.smallButtonText, primary && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

export function Table({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: "100%" }}>
        <View style={[styles.row, styles.rowHead]}>
          {columns.map((c) => (
            <Text key={c} style={[styles.cell, styles.cellHead]}>
              {c}
            </Text>
          ))}
        </View>
        {rows.map((r, i) => (
          <View key={i} style={styles.row}>
            {r.map((c, j) => (
              <View key={j} style={styles.cell}>
                {typeof c === "string" || typeof c === "number" ? <Text style={styles.cellText}>{c}</Text> : c}
              </View>
            ))}
          </View>
        ))}
        {rows.length === 0 && <Text style={[styles.cellText, { padding: 12, color: colors.muted }]}>Nothing yet.</Text>}
      </View>
    </ScrollView>
  );
}

export function Loading() {
  return <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />;
}

export function ErrorText({ text }: { text: string | null }) {
  return text ? <Text style={styles.error}>{text}</Text> : null;
}

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "–");

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glassStrong,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text, fontFamily },
  stat: { flexGrow: 1, flexBasis: 140, backgroundColor: colors.glassStrong, borderColor: colors.glassBorder, borderWidth: 1, borderRadius: 14, padding: 16 },
  statValue: { fontSize: 26, fontWeight: "600", color: colors.text, fontFamily },
  statLabel: { fontSize: 13, color: colors.muted, marginTop: 2, fontFamily },
  badge: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "600", fontFamily },
  dot: { width: 10, height: 10, borderRadius: 5 },
  smallButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  smallButtonText: { fontSize: 13, fontWeight: "600", color: colors.text, fontFamily },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(107,106,138,0.14)" },
  rowHead: { borderBottomColor: "rgba(107,106,138,0.3)" },
  cell: { flex: 1, minWidth: 170, paddingVertical: 10, paddingHorizontal: 8, justifyContent: "center" },
  cellHead: { fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4, fontFamily },
  cellText: { fontSize: 14, color: colors.text, fontFamily },
  error: { color: colors.danger, fontSize: 14, fontFamily },
});
