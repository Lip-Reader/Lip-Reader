import { StyleSheet, Text, View } from "react-native";
import { admin } from "../../../lib/api";
import { colors, fontFamily } from "../../../ui/theme";
import { Card, Dot, ErrorText, Loading, SmallButton, Stat } from "../ui";
import { useAdminData } from "../useAdminData";

export default function Overview() {
  const { data, error, loading, refresh } = useAdminData(admin.overview);
  if (loading && !data) return <Loading />;
  return (
    <View style={{ gap: 14 }}>
      <ErrorText text={error} />
      {data && (
        <>
          <View style={styles.grid}>
            <Stat label="Users" value={data.users} />
            <Stat label="Saved settings" value={data.settings_rows} />
            <Stat label="Open support" value={data.support_open} />
            <Stat label="Runs (24h)" value={data.runs_24h} />
          </View>
          <Card title="Health" actions={<SmallButton label="Refresh" onPress={refresh} />}>
            <View style={styles.health}>
              {[
                ["API", data.api_ok],
                ["VSR service", data.vsr_ok],
                ["Database", data.db_ok],
              ].map(([name, ok]) => (
                <View key={String(name)} style={styles.healthRow}>
                  <Dot ok={!!ok} />
                  <Text style={styles.healthText}>{name}</Text>
                </View>
              ))}
            </View>
          </Card>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  health: { flexDirection: "row", flexWrap: "wrap", gap: 20 },
  healthRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  healthText: { fontSize: 14, color: colors.text, fontFamily },
});
