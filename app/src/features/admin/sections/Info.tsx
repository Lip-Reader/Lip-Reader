import { useCallback } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { admin, API_BASE, VSR_BASE } from "../../../lib/api";
import { colors, fontFamily } from "../../../ui/theme";
import { Badge, Card, ErrorText, Loading } from "../ui";
import { useAdminData } from "../useAdminData";

const ENDPOINTS: [string, string][] = [
  ["POST /api/execute_lips", "video clip → sentence + steps (VSR service)"],
  ["POST /speak", "text → audio + word timestamps (Inworld TTS)"],
  ["GET /voices · POST /voice/select · POST /voice/enroll", "voice catalog, selection, cloning"],
  ["GET /api/settings/public · GET/PUT /api/me/settings", "global defaults · per-user settings"],
  ["POST /api/support · POST /api/runs", "feedback · lip-read run log (text only)"],
  ["GET /api/admin/*", "overview, users, settings, support, audit, runs"],
  ["GET /api/team_info · /api/agent_info · /api/model_architecture", "workshop metadata"],
];

export default function Info() {
  const load = useCallback(async () => ({ team: await admin.teamInfo(), agent: await admin.agentInfo() }), []);
  const { data, error, loading } = useAdminData(load);
  return (
    <View style={{ gap: 14 }}>
      <Card title="Chaplin AI">
        <Text style={styles.p}>
          Chaplin AI helps non-vocal, ventilated patients communicate: it lip-reads them from the camera and speaks the result back in a natural voice.
        </Text>
        <Text style={styles.p}>
          A camera clip is transcribed by the <Badge text="vsr" tone="accent" /> model (Auto-AVSR). A single <Badge text="correct" tone="accent" /> LLM call turns the noisy transcription into a natural, punctuated sentence. Video is deleted right after inference; only text leaves the device.
        </Text>
        <Image source={{ uri: admin.architectureUrl }} style={styles.diagram} resizeMode="contain" accessibilityLabel="Architecture diagram" />
      </Card>
      <Card title="Endpoints">
        {ENDPOINTS.map(([path, what]) => (
          <View key={path} style={styles.endpoint}>
            <Text style={styles.code}>{path}</Text>
            <Text style={styles.muted}>{what}</Text>
          </View>
        ))}
        <Text style={styles.muted}>API: {API_BASE || "same origin"} · VSR: {VSR_BASE}</Text>
      </Card>
      <ErrorText text={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <Card title="Agent">
              <Text style={styles.p}>{data.agent.description}</Text>
              <Text style={styles.label}>Purpose</Text>
              <Text style={styles.p}>{data.agent.purpose}</Text>
              <Text style={styles.label}>Prompt template</Text>
              <Text style={styles.code}>{data.agent.prompt_template.template}</Text>
            </Card>
            <Card title={data.team.team_name}>
              {data.team.students.map((s) => (
                <Text key={s.email} style={styles.p}>
                  {s.name} · <Text style={styles.muted}>{s.email}</Text>
                </Text>
              ))}
            </Card>
          </>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  p: { fontSize: 15, color: colors.text, lineHeight: 23, fontFamily },
  muted: { fontSize: 13, color: colors.muted, fontFamily },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4, fontFamily },
  code: { fontSize: 13, color: colors.text, fontFamily: "Menlo, monospace", lineHeight: 20 },
  endpoint: { gap: 2, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "rgba(107,106,138,0.14)" },
  diagram: { width: "100%", height: 220, borderRadius: 12, backgroundColor: colors.white },
});
