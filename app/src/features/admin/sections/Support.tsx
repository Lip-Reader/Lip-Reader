import { StyleSheet, Text, View } from "react-native";
import { admin } from "../../../lib/api";
import { colors, fontFamily } from "../../../ui/theme";
import { Badge, Card, ErrorText, Loading, SmallButton, when } from "../ui";
import { useAdminData } from "../useAdminData";

export default function Support() {
  const { data, error, loading, refresh, getToken } = useAdminData(admin.support);

  async function setStatus(id: number, status: "open" | "closed") {
    await admin.setSupportStatus(await getToken(), id, status).catch(() => {});
    refresh();
  }

  if (loading && !data) return <Loading />;
  return (
    <View style={{ gap: 14 }}>
      <ErrorText text={error} />
      <Card title={`Messages (${data?.length ?? 0})`} actions={<SmallButton label="Refresh" onPress={refresh} />}>
        {(data || []).map((m) => (
          <View key={m.id} style={styles.item}>
            <View style={styles.meta}>
              <Badge text={m.status} tone={m.status === "open" ? "accent" : "neutral"} />
              <Text style={styles.metaText}>{m.email || "guest"}</Text>
              <Text style={styles.metaText}>{when(m.created_at)}</Text>
            </View>
            <Text style={styles.message}>{m.message}</Text>
            <SmallButton label={m.status === "open" ? "Close" : "Reopen"} onPress={() => setStatus(m.id, m.status === "open" ? "closed" : "open")} />
          </View>
        ))}
        {data?.length === 0 && <Text style={styles.metaText}>No messages yet.</Text>}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(107,106,138,0.14)" },
  meta: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  metaText: { fontSize: 13, color: colors.muted, fontFamily },
  message: { fontSize: 15, color: colors.text, fontFamily, lineHeight: 22 },
});
