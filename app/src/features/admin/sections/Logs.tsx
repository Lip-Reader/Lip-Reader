import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { admin } from "../../../lib/api";
import { colors, fontFamily, radius } from "../../../ui/theme";
import { Card, ErrorText, Loading, SmallButton, Table, when } from "../ui";
import { useAdminData } from "../useAdminData";

export default function Logs() {
  const [tab, setTab] = useState<"audit" | "runs">("audit");
  const load = useCallback(async (t: string | null) => ({ audit: await admin.audit(t), runs: await admin.runs(t) }), []);
  const { data, error, loading, refresh } = useAdminData(load);

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.tabs}>
        {(["audit", "runs"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && { color: colors.text }]}>{t === "audit" ? "Audit" : "Runs"}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorText text={error} />
      <Card title={tab === "audit" ? "Admin actions" : "Lip-read runs"} actions={<SmallButton label="Refresh" onPress={refresh} />}>
        {loading && !data ? (
          <Loading />
        ) : tab === "audit" ? (
          <Table
            columns={["Time", "Actor", "Action", "Detail"]}
            rows={(data?.audit || []).map((e) => [when(e.created_at), e.actor, e.action, JSON.stringify(e.detail)])}
          />
        ) : (
          <Table
            columns={["Time", "User", "Raw", "Corrected", "Heard", "Latency"]}
            rows={(data?.runs || []).map((r) => [when(r.created_at), r.user_id || "guest", r.raw, r.corrected, r.heard || "–", r.latency_ms != null ? `${r.latency_ms} ms` : "–"])}
          />
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.5)", borderRadius: radius.pill, padding: 4, alignSelf: "flex-start" },
  tab: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.white },
  tabText: { color: colors.muted, fontWeight: "600", fontSize: 14, fontFamily },
});
