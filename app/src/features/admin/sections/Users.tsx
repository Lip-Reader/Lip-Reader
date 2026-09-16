import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { admin } from "../../../lib/api";
import { colors, fontFamily, radius } from "../../../ui/theme";
import { Badge, Card, ErrorText, Loading, SmallButton, Table, when } from "../ui";
import { useAdminData } from "../useAdminData";

export default function Users() {
  const { data, error, loading, refresh } = useAdminData(admin.users);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const rows = (data || []).filter((u) => !query || [u.email, u.name, u.id].some((s) => (s || "").toLowerCase().includes(query)));
  return (
    <View style={{ gap: 14 }}>
      <TextInput value={q} onChangeText={setQ} placeholder="Search by email or name" placeholderTextColor={colors.muted} style={styles.input} />
      <ErrorText text={error} />
      <Card title={`Users (${rows.length})`} actions={<SmallButton label="Refresh" onPress={refresh} />}>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table
            columns={["Email", "Name", "Role", "Voice", "Created", "Last sign-in"]}
            rows={rows.map((u) => [
              u.email,
              u.name || "–",
              <Badge key="r" text={u.role || "user"} tone={u.role === "admin" ? "accent" : "neutral"} />,
              u.voice_id || "–",
              when(u.created_at),
              when(u.last_sign_in_at),
            ])}
          />
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.glassStrong,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    fontFamily,
  },
});
